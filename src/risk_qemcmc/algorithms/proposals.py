"""Classical MCMC Proposals for Baseline Testing"""

import numpy as np


def local_proposal(state: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Flip one uniformly chosen spin."""
    out = state.copy()
    out[rng.integers(len(state))] *= -1
    return out


def uniform_proposal(state: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Fresh uniform random state."""
    return rng.choice([-1, 1], size=len(state))
