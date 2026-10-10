"""Network-risk Ising instances

Nodes are institutions; z_i = +1 healthy, -1 defaulted.
Couplings (J_ij < 0 in the E = 0.5 z^T J z + h^T z sign convention) make
neighbouring spins prefer to agree, so defaults cluster;
The shock field h_i < 0 biases every node toward healthy, and the balance h_i vs J_ij*deg_i
sets a nucleation barrier between the all-healthy and cascade basins.

A shock is a Route-1 diagonal Z-field kick: add delta to h on the shocked
nodes, which keeps the target diagonal so exact Metropolis acceptance
survives.
"""

import numpy as np


def risk_network(n: int, seed: int, core_frac: float = 0.3) -> tuple[np.ndarray, list[int]]:
    """Weighted core-periphery adjacency (dense strong core, weak spokes)."""
    rng = np.random.default_rng(seed)
    n_core = max(2, round(core_frac * n))
    A = np.zeros((n, n))
    for i in range(n):
        for j in range(i + 1, n):
            core = i < n_core and j < n_core
            periph = i < n_core or j < n_core
            p = 0.9 if core else 0.5 if periph else 0.1
            if rng.random() < p:
                w = 1.0 if core else float(rng.uniform(0.3, 0.7))
                A[i, j] = A[j, i] = w
    return A, list(range(n_core))


def risk_instance(
    n: int, seed: int, coupling: float = 0.5, health: float = 0.5
) -> tuple[np.ndarray, np.ndarray, list[int]]:
    """Contagion Ising (J, h, core):
        J = -coupling*A (ferromagnetic),
        h = -health (healthy-leaning)."""
    A, core = risk_network(n, seed)
    return -coupling * A, -health * np.ones(n), core


def apply_shock(h: np.ndarray, nodes, delta: float) -> np.ndarray:
    """Route-1 shock: diagonal field kick pushing the shocked nodes toward default."""
    out = h.copy()
    out[list(nodes)] += delta
    return out


def default_counts(states: np.ndarray) -> np.ndarray:
    """Defaults per state; works on one state (n,) or a chain (T, n)."""
    return ((1 - np.asarray(states)) // 2).sum(-1)


def exact_cascade(J: np.ndarray, h: np.ndarray, beta: float, k: int) -> float:
    """Exact Boltzmann P(#defaults >= k) by enumeration (small n only)."""
    n = len(h)
    assert n <= 16, "exact_cascade only works for small n"

    states = ((np.arange(2**n)[:, None] >> np.arange(n)) & 1) * 2 - 1
    energies = 0.5 * np.einsum("si,ij,sj->s", states, J, states) + states @ h
    weights = np.exp(-beta * (energies - energies.min()))
    weights /= weights.sum()
    defaults = ((1 - states) // 2).sum(1)
    return float(weights[defaults >= k].sum())
