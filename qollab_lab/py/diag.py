"""Numpy-only diagnostics helpers vendored from risk_qemcmc.analysis.diagnostics.

ESS uses Geyer's initial positive sequence on the FFT autocorrelation;
no arviz on the import path (arviz_stats has no wasm wheel for Pyodide).
"""

import numpy as np


def autocorr(x: np.ndarray, max_lag: int = 100) -> np.ndarray:
    """Normalized autocorrelation of a 1-D series via FFT."""
    x = np.asarray(x, dtype=float)
    x = x - x.mean()
    n = len(x)
    nfft = 1 << (2 * n - 1).bit_length()
    f = np.fft.rfft(x, nfft)
    acov = np.fft.irfft(f * np.conjugate(f), nfft)[:n]
    if acov[0] <= 0:
        return np.zeros(min(max_lag, n))
    return (acov / acov[0])[:max_lag]


def ess(x: np.ndarray) -> float:
    """Effective sample size via Geyer's initial positive sequence."""
    x = np.asarray(x, dtype=float)
    n = len(x)
    rho = autocorr(x, max_lag=n)
    if not rho.any():
        return float(n)
    tau = 1.0
    for k in range(1, n - 2, 2):
        pair = rho[k] + rho[k + 1]
        if pair < 0:
            break
        tau += 2 * pair
    return float(n / max(tau, 1.0))


def susceptibility(states: np.ndarray, beta: float) -> np.ndarray:
    """Bailout susceptibility chi_ij = beta Cov(z_i, z_j) from chain samples."""
    states = np.asarray(states, dtype=float)
    return beta * np.cov(states.T)