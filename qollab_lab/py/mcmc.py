"""Metropolis-Hastings driver"""

from dataclasses import dataclass

import numpy as np

from .proposals import local_proposal
from .qubo import ising_energy


@dataclass
class MCMCResult:
    states: np.ndarray
    energies: np.ndarray
    accepted: np.ndarray
    total_shots: int | None = None
    kept_shots: int | None = None
    shot_trace: list | None = None
    discards: int = 0
    keep_rate: float = 1.0

    @property
    def acceptance_rate(self) -> float:
        return float(np.mean(self.accepted))

    @property
    def n_steps(self) -> int:
        return len(self.energies)

    @property
    def total_shots_or_steps(self) -> int:
        """Shots if recorded (quantum/post-selected runs), else chain steps."""
        return self.total_shots if self.total_shots is not None else self.n_steps

    @property
    def post_selection_rate(self) -> float:
        if self.total_shots is None or self.kept_shots is None:
            return 1.0
        return self.kept_shots / self.total_shots


class MCMC:
    def __init__(self, J, h, beta=1.0, propose=local_proposal, rng=None):
        self.Couplings, self.Stress_field, self.beta = J, h, beta
        self.propose = propose
        self.rng = rng if rng is not None else np.random.default_rng()

    def step(self, z: np.ndarray, energy: float) -> tuple[np.ndarray, float, bool]:
        prop = self.propose(z, self.rng)
        dE = ising_energy(prop, self.Couplings, self.Stress_field) - energy
        if dE <= 0 or self.rng.random() < np.exp(-self.beta * dE):
            return prop, energy + dE, True
        return z, energy, False

    def sample(self, n_steps: int, z0=None, burn_in: int = 0, thin: int = 1,
               progress: bool = False, desc: str = "sampling") -> MCMCResult:
        n = len(self.Stress_field)
        z = self.rng.choice([-1, 1], size=n) if z0 is None else np.array(z0)
        energy = ising_energy(z, self.Couplings, self.Stress_field)
        states, energies, accepted = [], [], []
        for i in range(-burn_in, n_steps):
            z, energy, did_accept = self.step(z, energy)
            if i >= 0 and i % thin == 0:
                states.append(z.copy())
                energies.append(energy)
                accepted.append(did_accept)
        result = MCMCResult(
            states=np.array(states),
            energies=np.array(energies),
            accepted=np.array(accepted, dtype=bool),
        )
        return result
