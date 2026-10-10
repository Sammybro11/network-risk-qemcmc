"""Trotterised QeMCMC proposal circuits.

H = (1 - gamma) alpha H_prob + gamma H_mix, with H_mix = sum_j X_j,

H_prob = sum_{i<j} J_ij Z_i Z_j + sum_i h_i Z_i, and the Frobenius-norm
normalisation alpha = ||H_mix||_F / ||H_prob||_F, which keeps gamma's meaning
independent of problem size.

(Layden et al., Nature 619, 282 (2023),arXiv:2203.12497;
Ferguson & Wallden, arXiv:2405.04247)
"""

import numpy as np
from qiskit import QuantumCircuit


def mixer_weight(J: np.ndarray, h: np.ndarray) -> float:
    """alpha = ||H_mix||_F / ||H_prob||_F = sqrt(n) / sqrt(sum J_ij^2 + sum h_i^2).

    For SK (J_ij = +-1, h = 0) this is sqrt(2 / (n - 1))."""
    n = len(h)
    return float(np.sqrt(n) / np.sqrt((np.triu(J, 1) ** 2).sum() + (h**2).sum()))


def trotter_circuit(
    J: np.ndarray,
    h: np.ndarray,
    gamma: float,
    time: float,
    r: int,
    initial_bits=None,
    measure: bool = True,
) -> QuantumCircuit:
    """One QeMCMC proposal circuit: initial basis state, r Trotter steps,
    measure all. Bit i corresponds to spin z_i (+1 -> |0>, -1 -> |1>).

    measure=False omits the measurement so Statevector/Aer density-matrix
    simulation can read out the full probability vector directly."""
    n = len(h)
    dt = time / r
    alpha = mixer_weight(J, h)
    qc = QuantumCircuit(n)
    if initial_bits is not None:
        for i, b in enumerate(initial_bits):
            if b:
                qc.x(i)
    for _ in range(r):
        for i in range(n):
            for j in range(i + 1, n):
                if J[i, j] != 0:
                    qc.rzz(2 * (1 - gamma) * alpha * dt * J[i, j], i, j)
        for i in range(n):
            if h[i] != 0:
                qc.rz(2 * (1 - gamma) * alpha * dt * h[i], i)
        qc.barrier()
        for i in range(n):
            qc.rx(2 * gamma * dt, i)
    if measure:
        qc.measure_all()
    return qc
