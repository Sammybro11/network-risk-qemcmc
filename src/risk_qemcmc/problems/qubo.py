"""Ising instances: E(z) = 0.5 z^T J z + h^T z, z_i in {-1, +1}."""

import numpy as np


def sk_instance(n: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """Sherrington-Kirkpatrick: J_ij uniform in {+1, -1}, h = 0."""
    rng = np.random.default_rng(seed)
    J = rng.choice([-1.0, 1.0], size=(n, n))
    J = np.triu(J, 1)
    return J + J.T, np.zeros(n)

def ising_energy(z, J: np.ndarray, h: np.ndarray) -> float:
    z = np.asarray(z, dtype=float)
    return float(0.5 * z @ J @ z + h @ z)


def _enumerate(J: np.ndarray, h: np.ndarray, beta: float):
    n = len(h)
    assert n < 16, "n too large for exact enumeration"
    states = ((np.arange(2**n)[:, None] >> np.arange(n)) & 1) * 2 - 1
    energies = 0.5 * np.einsum("si,ij,sj->s", states, J, states) + states @ h
    weights = np.exp(-beta * (energies - energies.min()))
    weights /= weights.sum()
    return states, weights


def exact_moments(J: np.ndarray, h: np.ndarray, beta: float) -> tuple[float, float]:
    """Exact Boltzmann mean and std of the energy by full enumeration.

    Only feasible for small n (2^n states)"""
    states, weights = _enumerate(J, h, beta)
    energies = 0.5 * np.einsum("si,ij,sj->s", states, J, states) + states @ h
    mean = float(weights @ energies)
    return mean, float(np.sqrt(weights @ (energies - mean) ** 2))


def exact_mean_spin(J: np.ndarray, h: np.ndarray, beta: float) -> np.ndarray:
    """Exact Boltzmann <z_i> per spin (health tendency; -<z> is failure tendency)."""
    states, weights = _enumerate(J, h, beta)
    return weights @ states


def exact_susceptibility(J: np.ndarray, h: np.ndarray, beta: float) -> np.ndarray:
    """Exact bailout susceptibility chi_ij = beta Cov(z_i, z_j) by enumeration."""
    states, weights = _enumerate(J, h, beta)
    mean = weights @ states
    cov = (states * weights[:, None]).T @ states - np.outer(mean, mean)
    return beta * cov
