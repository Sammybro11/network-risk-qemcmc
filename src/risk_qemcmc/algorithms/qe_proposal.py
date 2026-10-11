"""
Quantum-enhanced proposal Structure

Per step, gamma and time are sampled (uniformly if given as (min, max)
ranges) following literature given by Layden et al.

Trotter control: pass either fixed r (number of steps, dt = t/r varies)
or fixed delta_t (r = floor(t/dt) varies), not both; default delta_t = 0.8.

The proposal is symmetric (H_prob diagonal, H_mix real), so the MH ratio
collapses to the Boltzmann factor and MCMC needs no Q evaluation.
"""

import warnings

import numpy as np

from ..compile.trotter import trotter_circuit

DEFAULT_DT = 0.8


class QeProposal:
    def __init__(
        self,
        J: np.ndarray,
        h: np.ndarray,
        gamma: float | tuple[float, float] = (0.25, 0.6),
        time: float | tuple[float, float] = (2.0, 20.0),
        r: int | None = None,
        delta_t: float | None = None,
        simulator=None,
    ):
        if r is not None and delta_t is not None:
            raise ValueError("pass only one of r or delta_t")
        self.J, self.h = J, h
        self.gamma, self.time = gamma, time
        self.r, self.delta_t = r, delta_t
        if simulator is not None:
            # e.g. qollab's pre-created `backend` global (WASM Aer or BasicSimulator)
            self.sim = simulator
        else:
            # ponytail: cap Aer's OpenMP pool at 1 thread; shots=1 makes its internal
            # parallelism pure overhead, and many worker processes otherwise thrash
            from qiskit_aer import AerSimulator

            self.sim = AerSimulator(max_parallel_threads=1)
        self._check_dt()

    @staticmethod
    def _sample(value, rng: np.random.Generator) -> float:
        return float(rng.uniform(*value)) if isinstance(value, tuple) else float(value)

    def _check_dt(self) -> None:
        t_lo, t_hi = self.time if isinstance(self.time, tuple) else (self.time, self.time)
        if self.r is not None:
            dt_lo, dt_hi = t_lo / self.r, t_hi / self.r
        else:
            dt_lo = dt_hi = self.delta_t if self.delta_t is not None else DEFAULT_DT
        if dt_lo < 0.1 or dt_hi > 2.0:
            warnings.warn(
                f"Trotter dt range [{dt_lo:.3f}, {dt_hi:.3f}] outside recommended [0.1, 2.0]",
                stacklevel=2,
            )

    def _draw_params(self, rng: np.random.Generator) -> tuple[float, float, int]:
        g = self._sample(self.gamma, rng)
        t = self._sample(self.time, rng)
        r = self.r if self.r is not None else max(1, int(np.floor(t / (self.delta_t or DEFAULT_DT))))
        return g, t, r

    def _propose_bits(self, bits: np.ndarray, g: float, t: float, r: int) -> np.ndarray:
        qc = trotter_circuit(self.J, self.h, g, t, r, initial_bits=bits)
        counts = self.sim.run(qc, shots=1).result().get_counts()
        return np.array([int(b) for b in next(iter(counts))[::-1]])

    def __call__(self, z: np.ndarray, rng: np.random.Generator) -> np.ndarray:
        g, t, r = self._draw_params(rng)
        self.last_params = (g, t, r)  # recorded by tracing wrappers; do not rely on it in the MH path
        bits = ((1 - np.asarray(z)) // 2).astype(int)
        return 1 - 2 * self._propose_bits(bits, g, t, r)
