"""MCMC diagnostics: ESS, autocorrelation.

All functions operate on MCMCResult, so they work identically for
classical and quantum-enhanced runs. Pure numpy: ESS uses Geyer's
initial positive sequence on the FFT autocorrelation.
"""

import numpy as np

from ..algorithms.mcmc import MCMCResult


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


class Diagnostics:
    """Statistics for a single chain, with optional exact reference values."""

    def __init__(self, result: MCMCResult, reference_energy: float | None = None):
        self.result = result
        self.reference_energy = reference_energy

    def ess(self) -> float:
        """Effective sample size of the energy series."""
        return ess(self.result.energies)

    def autocorr(self, max_lag: int = 100) -> np.ndarray:
        return autocorr(self.result.energies, max_lag)

    def energy_mean(self) -> float:
        return float(np.mean(self.result.energies))

    def energy_bias(self) -> float:
        """mean(chain energy) - reference; needs reference_energy."""
        if self.reference_energy is None:
            raise ValueError("no reference_energy supplied")
        return self.energy_mean() - self.reference_energy

    def energy_stderr(self) -> float:
        """Standard error of the mean energy, ESS-corrected."""
        return float(np.std(self.result.energies) / np.sqrt(self.ess()))


def susceptibility(states: np.ndarray, beta: float) -> np.ndarray:
    """Bailout susceptibility chi_ij = beta Cov(z_i, z_j) from chain samples."""
    states = np.asarray(states, dtype=float)
    return beta * np.cov(states.T)