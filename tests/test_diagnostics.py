import numpy as np
import pytest

from risk_qemcmc.algorithms.mcmc import MCMC
from risk_qemcmc.algorithms.proposals import local_proposal
from risk_qemcmc.analysis.diagnostics import Diagnostics, autocorr, ess, susceptibility
from risk_qemcmc.problems.finance import financial_instance
from risk_qemcmc.problems.qubo import exact_moments, exact_susceptibility


def test_autocorr_matches_direct_computation():
    rng = np.random.default_rng(2)
    x = rng.normal(size=500)
    a = autocorr(x, max_lag=10)
    assert a[0] == 1.0
    x0 = x - x.mean()
    denom = float(x0 @ x0)
    for lag in (1, 5, 9):
        direct = float(x0[lag:] @ x0[:-lag]) / denom
        assert a[lag] == pytest.approx(direct, abs=1e-10)


def test_ess_of_iid_noise_is_near_n():
    rng = np.random.default_rng(0)
    assert ess(rng.normal(size=4000)) > 0.8 * 4000


def test_ess_shrinks_for_autocorrelated_series():
    rng = np.random.default_rng(1)
    x = np.empty(4000)
    x[0] = rng.normal()
    for t in range(1, len(x)):
        x[t] = 0.95 * x[t - 1] + rng.normal()
    assert ess(x) < 0.25 * len(x)


def test_ess_of_constant_series_is_n():
    assert ess(np.ones(100)) == 100.0


def test_susceptibility_matches_exact_on_small_instance():
    J, h, _A, _tiers = financial_instance(8, seed=3, lam=4.0, vuln=0.05)
    beta = 0.8
    chains = [
        MCMC(J, h, beta=beta, propose=local_proposal, rng=np.random.default_rng(s)).sample(
            6000, z0=np.ones(len(h)), burn_in=500
        )
        for s in range(4)
    ]
    chi = susceptibility(np.concatenate([c.states for c in chains]), beta)
    chi_exact = exact_susceptibility(J, h, beta)
    relerr = np.linalg.norm(chi - chi_exact) / np.linalg.norm(chi_exact)
    assert relerr < 0.15


def test_exact_enumeration_barrier_raised_to_20():
    J, h, _A, _tiers = financial_instance(16, seed=3, lam=4.0, vuln=0.05)
    mean_e, _std = exact_moments(J, h, 1.0)
    assert np.isfinite(mean_e)
    with pytest.raises(AssertionError):
        exact_moments(np.eye(21), np.zeros(21), 1.0)


def test_diagnostics_ess_positive_and_stderr_finite():
    rng = np.random.default_rng(5)
    chain = MCMC(*financial_instance(8, seed=3, lam=4.0, vuln=0.05)[:2],
                 beta=0.8, propose=local_proposal, rng=rng).sample(
        2000, z0=np.ones(8), burn_in=200
    )
    d = Diagnostics(chain)
    assert 0 < d.ess() <= chain.n_steps
    assert np.isfinite(d.energy_stderr())
