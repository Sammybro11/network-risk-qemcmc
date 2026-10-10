"""Exact ground truth by 2^n enumeration (numpy only, Pyodide-safe).

Boltzmann moments, bailout susceptibility chi = beta Cov(z), magnetization
under bailout fields, and optimal bailout sets by exhaustive subset search.
Same conventions as risk_qemcmc.problems.qubo.
"""

from itertools import combinations

import numpy as np

from . import instance


def _enumerate(J, h, beta):
    n = len(h)
    assert n < 16, "n too large for exact enumeration"
    states = ((np.arange(2**n)[:, None] >> np.arange(n)) & 1) * 2 - 1
    energies = 0.5 * np.einsum("si,ij,sj->s", states, J, states) + states @ h
    weights = np.exp(-beta * (energies - energies.min()))
    weights /= weights.sum()
    return states, energies, weights


def _instance_Jh(n, seed, lam, vuln):
    inst = instance.build(n, seed, lam, vuln)
    return np.array(inst["J"]), np.array(inst["h"])


def ground_truth(n, seed, lam, vuln, beta):
    """Exact mean energy, mean spins, and susceptibility matrix."""
    J, h = _instance_Jh(n, seed, lam, vuln)
    states, energies, weights = _enumerate(J, h, beta)
    mean_e = float(weights @ energies)
    mean_spin = weights @ states
    cov = (states * weights[:, None]).T @ states - np.outer(mean_spin, mean_spin)
    chi = beta * cov
    return {
        "energy": mean_e,
        "energy_std": float(np.sqrt(weights @ (energies - mean_e) ** 2)),
        "mean_spin": mean_spin.tolist(),
        "m": float(mean_spin.mean()),
        "chi": chi.tolist(),
        "mu": chi.mean(axis=0).tolist(),
    }


def bailout_value(n, seed, lam, vuln, beta, nodes, omega):
    """Exact magnetization m(S) with h_i -> h_i - omega on the rescued set."""
    J, h = _instance_Jh(n, seed, lam, vuln)
    h = h.astype(float)
    h[list(nodes)] -= omega
    _, _, weights = _enumerate(J, h, beta)
    states = ((np.arange(2**n)[:, None] >> np.arange(n)) & 1) * 2 - 1
    return float((weights @ states).mean())


def optimal_bailouts(n, seed, lam, vuln, beta, budget, omega):
    """Exhaustive best bailout set per budget K (cheap at n <= 12)."""
    J, h = _instance_Jh(n, seed, lam, vuln)

    def m_of(S):
        hh = h.astype(float)
        hh[list(S)] -= omega
        states, _, weights = _enumerate(J, hh, beta)
        return float((weights @ states).mean())

    out = {}
    for k in range(1, budget + 1):
        best_m, best_set = -np.inf, ()
        for S in combinations(range(n), k):
            m = m_of(S)
            if m > best_m:
                best_m, best_set = m, S
        out[str(k)] = {"m": best_m, "set": list(best_set)}
    return out
