"""Study orchestration for the qollab Python project.

Mirrors experiments/financial_contagion.py and traffic_congestion.py:
both sampler arms, static baselines, exact regret table, and the
sequential (re-ranked per dose) policy. Everything analytical lives in
the vendored package modules; `main.py` only drives this and plots.
"""

import itertools

import numpy as np

from .diag import ess, susceptibility
from .finance import (
    apply_bailout,
    debtrank_scores,
    eigenvector_scores,
    financial_instance,
    sequential_greedy,
    spearman,
    strength_scores,
)
from .mcmc import MCMC
from .proposals import local_proposal
from .qe_proposal import QeProposal
from .qubo import exact_mean_spin, exact_moments, exact_susceptibility
from .traffic import load_scores, traffic_instance


def build_instance(method, size, seed, lam, vuln, ring=True):
    if method == "finance":
        return financial_instance(size, seed=seed, lam=lam, vuln=vuln)
    return traffic_instance(size, seed=seed, lam=lam, vuln=vuln, ring=ring)


def run_chains(J, h, beta, propose, steps, chains, burn_in, seed_offset):
    results = []
    for seed in range(chains):
        results.append(
            MCMC(J, h, beta=beta, propose=propose, rng=np.random.default_rng(seed_offset + seed)).sample(
                steps, z0=np.ones(len(h)), burn_in=burn_in
            )
        )
    return results


def arm_study(J, h, beta, propose, steps, chains, burn_in, seed_offset):
    """chi/mu + diagnostics for one sampler arm."""
    results = run_chains(J, h, beta, propose, steps, chains, burn_in, seed_offset)
    chi = susceptibility(np.concatenate([r.states for r in results]), beta)
    return {
        "chi": chi,
        "mu": chi.mean(axis=0),
        "ess_per_step": float(np.mean([ess(r.energies) / r.n_steps for r in results])),
        "acceptance": float(np.mean([r.acceptance_rate for r in results])),
        "trace": np.mean([r.energies for r in results], axis=0),
    }


def exact_m(J, h, beta, omega, S):
    if not S:
        return float(exact_mean_spin(J, h, beta).mean())
    return float(exact_mean_spin(J, apply_bailout(h, list(S), omega), beta).mean())


def topk(scores, k):
    order = np.argsort(-np.asarray(scores, float))
    return [int(j) for j in order][:k]


def static_scores(A, method, seeds):
    A = np.asarray(A, float)
    if method == "strength":
        return strength_scores(A)
    if method == "eigenvector":
        return eigenvector_scores(A)
    if method == "debtrank":
        return debtrank_scores(A, seeds)
    if method == "load":
        return load_scores(A)
    raise ValueError(f"unknown baseline {method}")


def cascade_seeds(A, method):
    A = np.asarray(A, float)
    if method == "finance":
        return [0]
    return [int(np.argmax(A.sum(axis=0)))]


def optimal_m(J, h, beta, omega, budget):
    """True optimum per budget by exhaustive subset search (small n only)."""
    n = len(h)
    out = {}
    for k in range(1, budget + 1):
        subsets = list(itertools.combinations(range(n), k))
        assert len(subsets) <= 60000, "budget too large for exhaustive optimum"
        out[str(k)] = max(exact_m(J, h, beta, omega, list(S)) for S in subsets)
    return out


def random_m(J, h, beta, omega, budget, seed=0):
    rng = np.random.default_rng(seed)
    n = len(h)
    out = {}
    for k in range(1, budget + 1):
        vals = [exact_m(J, h, beta, omega, list(rng.choice(n, k, replace=False))) for _ in range(16)]
        out[str(k)] = float(np.mean(vals))
    return out


def sequential_arm(name, J, h0, beta, omega, budget, race_mu, propose, steps, chains, burn_in):
    """Reactive re-ranked policy; dose 1 reuses the race chi (CLI parity)."""
    cache = {}
    chain_calls = {"n": 0}

    def rank(h_k):
        key = np.asarray(h_k, float).tobytes()
        if key not in cache:
            if key == np.asarray(h0, float).tobytes() and race_mu is not None:
                cache[key] = np.asarray(race_mu, float)
            else:
                chain_calls["n"] += 1
                res = run_chains(J, h_k, beta, propose, steps, chains, burn_in, chain_calls["n"])
                cache[key] = susceptibility(np.concatenate([r.states for r in res]), beta).mean(axis=0)
        return cache[key]

    def mu_exact(h_k):
        return exact_susceptibility(J, h_k, beta).mean(axis=0)

    if name == "exact-seq":
        rank_fn = mu_exact
    else:
        rank_fn = rank

    order, trace = sequential_greedy(
        h0, omega, budget, rank_fn,
        lambda S: exact_m(J, h0, beta, omega, S),
    )
    return {str(k): {"m": m, "set": list(s)} for k, (s, m) in enumerate(trace, 1)}, order


def full_study(method, size, seed, lam, vuln, ring, beta, omega, budget,
               steps, chains, burn_in, backend=None):
    """Run the whole protocol; returns a plain dict the entry file renders."""
    J, h, A, tiers = build_instance(method, size, seed, lam, vuln, ring)
    n = len(h)

    chi_exact = exact_susceptibility(J, h, beta)
    mu_exact = chi_exact.mean(axis=0)
    exact_e, _ = exact_moments(J, h, beta)
    m_exact = float(exact_mean_spin(J, h, beta).mean())

    quantum = QeProposal(J, h, simulator=backend) if backend is not None else QeProposal(J, h)
    arms = {
        "metro": arm_study(J, h, beta, local_proposal, steps, chains, burn_in, 0),
        "quantum": arm_study(J, h, beta, quantum, steps, chains, burn_in, 42),
    }
    for arm in arms.values():
        arm["relerr"] = float(np.linalg.norm(arm["chi"] - chi_exact) / np.linalg.norm(chi_exact))
        arm["spearman"] = float(spearman(arm["mu"], mu_exact))

    seeds = cascade_seeds(A, method)
    statics = ["strength", "eigenvector", "debtrank"] if method == "finance" else ["load", "eigenvector", "debtrank"]
    strategies = {s: static_scores(A, s, seeds) for s in statics}
    strategies["metro-chi"] = arms["metro"]["mu"]
    strategies["quantum-chi"] = arms["quantum"]["mu"]

    table = {
        name: {str(k): {"m": exact_m(J, h, beta, omega, topk(scores, k)), "set": topk(scores, k)}
               for k in range(1, budget + 1)}
        for name, scores in strategies.items()
    }
    table["exact-seq"], _ = sequential_arm("exact-seq", J, h, beta, omega, budget, None, None, steps, chains, burn_in)
    table["metro-seq"], _ = sequential_arm("metro-seq", J, h, beta, omega, budget, arms["metro"]["mu"], local_proposal, steps, chains, burn_in)
    table["quantum-seq"], _ = sequential_arm("quantum-seq", J, h, beta, omega, budget, arms["quantum"]["mu"], quantum, steps, chains, burn_in)
    rand = random_m(J, h, beta, omega, budget)
    table["random-mean"] = {str(k): {"m": rand[str(k)], "set": []} for k in range(1, budget + 1)}

    return {
        "J": J, "h": h, "A": A, "tiers": [str(t) for t in tiers], "n": n,
        "chi_exact": chi_exact, "mu_exact": mu_exact, "exact_energy": exact_e,
        "m_exact": m_exact, "arms": arms, "table": table,
        "optimal": optimal_m(J, h, beta, omega, budget),
    }