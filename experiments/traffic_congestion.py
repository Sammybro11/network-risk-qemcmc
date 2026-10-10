"""Road-network congestion: susceptibility-driven widening, samplers vs baselines.

Applies the measurement protocol of experiments/financial_contagion.py to the
traffic layer (problems/traffic.py, thermodynamic framing of arXiv:2605.03879):

  1. Equilibrium susceptibility chi = beta Cov(z) from MCMC samples, with
     classical Metropolis vs the quantum proposal.
  2. Aggregate susceptibility mu_j = mean_i chi_ij -> widening ranking
     (bang-per-widening via fluctuation-dissipation).
  3. Intervention quality: exact mean free-flow m(S) under widening sets
     chosen by each ranking strategy, at each budget K.

Ranking strategies compared: exact chi (ground truth), Metropolis chi,
quantum chi, plus non-dynamical baselines: load centrality (VOC inflow),
eigenvector centrality, DebtRank-style incident distress propagation, and
random. The headline delta is ranking fidelity vs exact near the tipping
point, where Metropolis frozen in the gridlocked basin misranks.

Run (smoke):  uv run python experiments/traffic_congestion.py --steps 300 --chains 1 --burn-in 50
Run (full):   uv run python experiments/traffic_congestion.py
"""

import argparse

import numpy as np

from risk_qemcmc.algorithms.mcmc import MCMC
from risk_qemcmc.algorithms.proposals import local_proposal
from risk_qemcmc.algorithms.qe_proposal import QeProposal
from risk_qemcmc.analysis.diagnostics import Diagnostics, susceptibility
from risk_qemcmc.problems.finance import (
    cascade_closure,
    debtrank_scores,
    eigenvector_scores,
    sequential_greedy,
    spearman,
)
from risk_qemcmc.problems.qubo import (
    exact_mean_spin,
    exact_moments,
    exact_susceptibility,
)
from risk_qemcmc.problems.traffic import apply_widening, load_scores, traffic_instance


def run_chains(J, h, beta, propose, steps, chains, burn_in, seed_offset=42):
    results = []
    for seed in range(chains):
        results.append(
            MCMC(J, h, beta=beta, propose=propose, rng=np.random.default_rng(seed_offset + seed)).sample(
                steps, z0=np.ones(len(h)), burn_in=burn_in
            )
        )
    return results


def chi_from(results, beta):
    states = np.concatenate([r.states for r in results])
    return susceptibility(states, beta)


def topk(scores, k, exclude=()):
    order = np.argsort(-np.asarray(scores, float))
    return [int(j) for j in order if j not in exclude][:k]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--L", type=int, default=3, help="grid side; n = L^2 (exact needs n < 16)")
    ap.add_argument("--lam", type=float, default=2.0, help="coupling scale in J = -(lam/4)(F + F.T)")
    ap.add_argument("--vuln", type=float, default=0.05, help="load-pressure field scale")
    ap.add_argument("--beta", type=float, default=2.5, help="inverse temperature")
    ap.add_argument("--steps", type=int, default=2000)
    ap.add_argument("--chains", type=int, default=2)
    ap.add_argument("--burn-in", type=int, default=200)
    ap.add_argument("--budget", type=int, default=3)
    ap.add_argument("--omega", type=float, default=0.5, help="widening field strength")
    ap.add_argument("--theta", type=float, default=0.5, help="cascade threshold on inflow influence")
    ap.add_argument("--no-ring", action="store_true", help="drop the perimeter ring road")
    ap.add_argument("--fracs", nargs=3, type=float, default=(0.15, 0.35, 0.5),
                    help="tier fractions hub arterial local")
    args = ap.parse_args()

    J, h, A, tiers = traffic_instance(args.L, seed=42, lam=args.lam, vuln=args.vuln,
                                      ring=not args.no_ring, fracs=tuple(args.fracs))
    beta = args.beta
    n = len(h)

    print(f"grid network: L={args.L} (n={n}), tiers:", {t: int((tiers == t).sum()) for t in set(tiers)})
    seeds = [int(np.argmax(A.sum(axis=0)))]
    cascade = cascade_closure(A, args.theta, seeds)
    print(f"incident cascade from load seed {seeds} (theta={args.theta}): "
          f"{cascade.sum()}/{n} congested")

    chi_exact = exact_susceptibility(J, h, beta)
    mu_exact = chi_exact.mean(axis=0)
    exact_e, _ = exact_moments(J, h, beta)
    m_exact = float(exact_mean_spin(J, h, beta).mean())
    print(f"exact: <E>={exact_e:+.3f}, mean free-flow m={m_exact:+.3f}")

    arms = {
        "metro": local_proposal,
        "quantum": QeProposal(J, h),
    }
    samplers = {}
    print(f"\n{'arm':>8} {'chi relerr':>10} {'mu spear':>9} {'ESS/step':>9} {'accept':>7}")
    for name, propose in arms.items():
        results = run_chains(J, h, beta, propose, args.steps, args.chains, args.burn_in)
        chi = chi_from(results, beta)
        mu = chi.mean(axis=0)
        relerr = float(np.linalg.norm(chi - chi_exact) / np.linalg.norm(chi_exact))
        rho = spearman(mu, mu_exact)
        diags = [Diagnostics(r, reference_energy=exact_e) for r in results]
        ess_step = float(np.mean([d.ess() / r.n_steps for d, r in zip(diags, results)]))
        accept = float(np.mean([r.acceptance_rate for r in results]))
        samplers[name] = mu
        print(f"{name:>8} {relerr:>10.3f} {rho:>9.3f} {ess_step:>9.4f} {accept:>7.3f}")

    rng = np.random.default_rng(0)
    strategies = {
        "metro-chi": samplers["metro"],
        "quantum-chi": samplers["quantum"],
        "load": load_scores(A),
        "eigenvector": eigenvector_scores(A),
        "debtrank": debtrank_scores(A, seeds),
    }

    def exact_m(S):
        if not S:
            return m_exact
        return float(exact_mean_spin(J, apply_widening(h, S, args.omega), beta).mean())

    # true optimal per budget by exhaustive subset search (cheap at small n)
    from itertools import combinations

    opt_m = {}
    for k in range(1, args.budget + 1):
        opt_m[k] = max(exact_m(list(S)) for S in combinations(range(n), k))
    rand_m = {k: float(np.mean([exact_m(list(rng.choice(n, k, replace=False)))
                                for _ in range(16)])) for k in range(1, args.budget + 1)}

    # ---- sequential (re-ranked per dose) widening policy arms ----
    # Dose 1 reuses each arm's race chi (same chain seeds); later doses
    # re-equilibrate at the CURRENT field (h minus prior widenings), so the
    # policy is reactive instead of a static truncated ranking.
    def exact_mu(h_k):
        return exact_susceptibility(J, h_k, beta).mean(axis=0)

    def chain_mu(propose, h_k, seed_offset):
        results = run_chains(J, h_k, beta, propose, args.steps, args.chains,
                             args.burn_in, seed_offset=seed_offset)
        return susceptibility(np.concatenate([r.states for r in results]), beta).mean(axis=0)

    chain_calls = {"n": 0}

    def sequential_rank(race_mu, propose):
        cache = {}

        def rank(h_k):
            key = np.asarray(h_k, float).tobytes()
            if key not in cache:
                if key == np.asarray(h, float).tobytes() and race_mu is not None:
                    cache[key] = np.asarray(race_mu, float)
                elif propose is None:
                    cache[key] = exact_mu(h_k)
                else:
                    chain_calls["n"] += 1
                    cache[key] = chain_mu(propose, np.asarray(h_k, float), chain_calls["n"])
            return cache[key]

        return rank

    seq_rows = {}
    for name, race, prop in (
        ("exact-seq", None, None),
        ("metro-seq", samplers["metro"], local_proposal),
        ("quantum-seq", samplers["quantum"], QeProposal(J, h)),
    ):
        rank = sequential_rank(race, prop)
        order, trace = sequential_greedy(h, args.omega, args.budget, rank, exact_m)
        seq_rows[name] = {str(k): {"m": mval, "set": s} for k, (s, mval) in enumerate(trace, 1)}
        print(f"{name}: doses {order} -> "
              + ", ".join(f"K={k}: m={tm:.3f}" for k, (_s, tm) in enumerate(trace, 1)))

    table = {
        name: {str(k): {"m": exact_m(topk(scores, k)), "set": topk(scores, k)}
               for k in range(1, args.budget + 1)}
        for name, scores in strategies.items()
    }
    table.update(seq_rows)
    table["random-mean"] = {str(k): {"m": rand_m[k], "set": []} for k in range(1, args.budget + 1)}

    print(f"\nwidening ranking quality at omega={args.omega}: m(S) under relief / "
          f"regret vs exact optimum (higher m = freer flow, lower regret = better)")
    header = f"{'strategy':>12}" + "".join(f"  K={k:<9d}" for k in range(1, args.budget + 1))
    print(header)
    for name, row in table.items():
        cells = []
        for k in range(1, args.budget + 1):
            m = row[str(k)]["m"]
            cells.append(f"  {m:+.3f}/{opt_m[k] - m:.3f}")
        print(f"{name:>12}" + "".join(cells))
    print(f"{'exact-opt':>12}" + "".join(f"  {opt_m[k]:+.3f}/0.000" for k in range(1, args.budget + 1)))

    if args.steps * args.chains >= 4000:
        q_chains = run_chains(J, h, beta, QeProposal(J, h), args.steps, args.chains, args.burn_in)
        q_energy = float(np.mean([np.mean(r.energies) for r in q_chains]))
        q_stderr = float(np.std(np.concatenate([r.energies for r in q_chains])) /
                         np.sqrt(max(np.mean([Diagnostics(r).ess() for r in q_chains]), 1.0)))
        bias = q_energy - exact_e
        ok = abs(bias) < 4 * q_stderr + 1e-12
        print(f"\nquantum energy bias {bias:+.3f} vs exact {exact_e:+.3f} -> {'OK' if ok else 'FAIL'}")
        assert ok, "noiseless quantum chain off exact Boltzmann"


if __name__ == "__main__":
    main()
