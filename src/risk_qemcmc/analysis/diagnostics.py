"""MCMC diagnostics: ESS, Autocorrelation.

All functions operate on MCMCResult (or lists of it for R-hat),
so they work identically for classical and quantum-enhanced runs.
"""

import arviz as az
import numpy as np
from arviz_stats.base.array import array_stats as _az_array

from ..algorithms.mcmc import MCMCResult


class Diagnostics:
    """Statistics for a single chain, with optional exact reference values."""

    def __init__(self, result: MCMCResult, reference_energy: float | None = None):
        self.result = result
        self.reference_energy = reference_energy

    def ess(self) -> float:
        """Effective sample size of the energy series."""
        energies = np.asarray(self.result.energies)[None, :]
        return float(az.ess(energies))

    def autocorr(self, max_lag: int = 100) -> np.ndarray:
        return np.asarray(_az_array.autocorr(np.asarray(self.result.energies, dtype=float)))[:max_lag]

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

    def post_selection_rate(self) -> float:
        """kept_shots / total_shots; 1.0 for chains without post-selection."""
        return self.result.post_selection_rate

    def ess_per_shot(self) -> float:
        """ESS divided by total shots (incl. discards); the honest cost metric."""
        return self.ess() / self.result.total_shots_or_steps


def susceptibility(states: np.ndarray, beta: float) -> np.ndarray:
    """Bailout susceptibility chi_ij = beta Cov(z_i, z_j) from chain samples."""
    states = np.asarray(states, dtype=float)
    return beta * np.cov(states.T)


def rhat(results: list[MCMCResult]) -> float:
    """Rank-normalized split-R-hat over per-chain energy series (>= 2 chains)."""
    energies = np.asarray([r.energies for r in results])
    if energies.shape[0] < 2:
        raise ValueError("R-hat needs at least 2 chains")
    return float(az.rhat(energies))
