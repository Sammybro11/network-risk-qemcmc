"""Export a recorded reference run to qollab_app/data/run.json.

Runs the financial-contagion protocol (Metropolis vs QeMCMC) and serializes
everything the browser demo needs for instant replay: chain traces, chi and
mu per arm, baseline rankings, exact ground truth, and bailout regrets.

Run:  uv run python experiments/export_qollab_data.py [--steps 2000 --chains 2]
"""

import argparse
import json
from itertools import combinations
from pathlib import Path

import numpy as np

from risk_qemcmc.algorithms.mcmc import MCMC
from risk_qemcmc.algorithms.proposals import local_proposal
from risk_qemcmc.algorithms.qe_proposal import QeProposal
from risk_qemcmc.analysis.diagnostics import Diagnostics, susceptibility
from risk_qemcmc.problems.finance import (
    apply_bailout,
    cascade_closure,
    debtrank_scores,
    eigenvector_scores,
    financial_instance,
    spearman,
    strength_scores,
)
from risk_qemcmc.problems.qubo import (
    exact_mean_spin,
    exact_moments,
    exact_susceptibility,
)

OUT = Path(__file__).resolve().parent.parent / "qollab_app" / "data" / "run.json"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=12)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--lam", type=float, default=6.0)
    ap.add_argument("--vuln", type=float, default=0.0)
    ap.add_argument("--beta", type=float, default=1.66)
    ap.add_argument("--steps", type=int, default=2000)
    ap.add_argument("--chains", type=int, default=2)
    ap.add_argument("--burn-in", type=int, default=200)
    ap.add_argument("--budget", type=int, default=3)
    ap.add_argument("--omega", type=float, default=2.0)
    ap.add_argument("--theta", type=float, default=0.15)
    ap.add_argument("--stride", type=int, default=4, help="keep every k-th state")
    args = ap.parse_args()

    n = args.n
    J, h, A, tiers = financial_instance(n, seed=args.seed, lam=args.lam, vuln=args.vuln)
    beta = args.beta

    chi_exact = exact_susceptibility(J, h, beta)
    mu_exact = chi_exact.mean(axis=0)
    exact_e, exact_e_std = exact_moments(J, h, beta)
    mean_spin = exact_mean_spin(J, h, beta)
    m_exact = float(mean_spin.mean())

    seeds = [int(i) for i in np.where(tiers == "core")[0][:1]]
    cascade = cascade_closure(A, args.theta, seeds)

    arms = {}
    for name, propose in {
        "metro": local_proposal,
        "quantum": QeProposal(J, h),
    }.items():
        states_all, energies_all, accepted_all = [], [], []
        ess_vals = []
        for seed in range(args.chains):
            res = MCMC(
                J, h, beta=beta, propose=propose, rng=np.random.default_rng(seed)
            ).sample(args.steps, z0=np.ones(n), burn_in=args.burn_in)
            states_all.append(res.states)
            energies_all.append(res.energies)
            accepted_all.append(res.accepted)
            ess_vals.append(Diagnostics(res, reference_energy=exact_e).ess() / res.n_steps)
        states = np.concatenate(states_all)
        energies = np.concatenate(energies_all)
        accepted = np.concatenate(accepted_all)
        chi = susceptibility(states, beta)
        mu = chi.mean(axis=0)
        arms[name] = {
            "energies": np.asarray(energies, float).tolist(),
            "states": np.asarray(states[:: args.stride], int).tolist(),
            "stride": args.stride,
            "chi": chi.tolist(),
            "mu": mu.tolist(),
            "chi_relerr": float(np.linalg.norm(chi - chi_exact) / np.linalg.norm(chi_exact)),
            "mu_spearman": spearman(mu, mu_exact),
            "ess_per_step": float(np.mean(ess_vals)),
            "acceptance": float(np.mean(accepted)),
        }
        print(f"{name}: done, relerr={arms[name]['chi_relerr']:.3f}")

    def exact_m(S):
        if not S:
            return m_exact
        return float(exact_mean_spin(J, apply_bailout(h, S, args.omega), beta).mean())

    opt = {}
    for k in range(1, args.budget + 1):
        best_m, best_set = -np.inf, ()
        for S in combinations(range(n), k):
            m = exact_m(list(S))
            if m > best_m:
                best_m, best_set = m, S
        opt[str(k)] = {"m": best_m, "set": list(best_set)}

    rng = np.random.default_rng(0)
    rand_m = {
        str(k): float(np.mean([exact_m(list(rng.choice(n, k, replace=False))) for _ in range(16)]))
        for k in range(1, args.budget + 1)
    }

    def topk(scores, k):
        order = np.argsort(-np.asarray(scores, float))
        return [int(j) for j in order][:k]

    strategies = {
        "metro-chi": arms["metro"]["mu"],
        "quantum-chi": arms["quantum"]["mu"],
        "strength": strength_scores(A).tolist(),
        "eigenvector": eigenvector_scores(A).tolist(),
        "debtrank": debtrank_scores(A, seeds).tolist(),
    }
    bailout_table = {}
    for name, scores in strategies.items():
        bailout_table[name] = {
            str(k): {"m": exact_m(topk(scores, k)), "set": topk(scores, k)}
            for k in range(1, args.budget + 1)
        }
    bailout_table["random-mean"] = {k: {"m": v, "set": []} for k, v in rand_m.items()}

    payload = {
        "params": {
            "n": n, "seed": args.seed, "lam": args.lam, "vuln": args.vuln,
            "beta": beta, "omega": args.omega, "theta": args.theta,
            "budget": args.budget, "steps": args.steps, "chains": args.chains,
            "burn_in": args.burn_in,
        },
        "tiers": [str(t) for t in tiers],
        "cascade": {"seeds": seeds, "failed": [bool(b) for b in cascade]},
        "exact": {
            "energy": exact_e,
            "energy_std": exact_e_std,
            "mean_spin": np.asarray(mean_spin, float).tolist(),
            "m": m_exact,
            "chi": chi_exact.tolist(),
            "mu": mu_exact.tolist(),
        },
        "arms": arms,
        "strategies": strategies,
        "bailout": {"optimal": opt, "table": bailout_table},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KiB)")


if __name__ == "__main__":
    main()
