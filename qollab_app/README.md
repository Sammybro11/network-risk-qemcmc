# Quantum-Enhanced MCMC for Financial Contagion

**Theme: Quantum Impact.** An interactive, in-browser demo of quantum-enhanced
Markov Chain Monte Carlo (QeMCMC) applied to systemic risk in an interbank
network: which banks should a regulator bail out first to stop a cascade?

Press **Run**. The page above the console replays a recorded experiment
instantly, and **Run live on simulator** re-runs both samplers for real on
whichever backend you pick in the dialog (the built-in local simulator is
recommended: QeMCMC needs one circuit per MCMC step).

## The problem

Twelve institutions (core / intermediate / periphery tiers) hold each other's
equity. Following the EGJ framework as used by Tomar et al.
(arXiv:2609.17415), cross-holdings `C` fold into a dependency matrix
`A = Chat (I - C)^{-1}`, and the network maps to an Ising model

`E(z) = 1/2 z^T J z + h^T z`,  `J = -(lambda/4)(A + A^T)`,

with `z_i = +1` healthy and `-1` defaulted. The quantity that matters for
policy is the **bailout susceptibility** `chi = beta Cov(z)`: how strongly
rescuing bank `i` stabilises bank `j`. Its column means rank banks by systemic
importance.

## The quantum edge

Classical Metropolis single-spin flips freeze near the healthy basin at the
reference temperature, biasing `chi` toward zero covariance and corrupting the
ranking. The QeMCMC proposal (Layden et al., Nature 619, 282 (2023);
Ferguson & Wallden, arXiv:2405.04247) instead evolves the current state under
`(1 - gamma) * alpha * H_prob + gamma * sum X_j` for a random time and
re-measures, tunnelling between basins. The demo measures, per sampler:

- `chi` relative error against exact 2^12 enumeration,
- rank fidelity (Spearman) of the induced bank ranking,
- **bailout regret**: exact magnetization under the top-K rescue set chosen by
  each ranking vs the true optimum, vs strength / eigenvector / DebtRank
  (arXiv:1504.01857) / random baselines.

In the recorded run (beta = 2.5, 4000 steps x 2 chains per arm) Metropolis
freezes: acceptance drops to 0.07, its chi is ~99% off in relative norm, and
its bank ranking is *anti-correlated* with the truth (Spearman -0.74), leading
to a K=1 bailout regret of 0.30. The quantum chain (acceptance 0.20) recovers
chi to 0.018 relative error, Spearman +0.87, and near-zero regret.

## How it runs

- `quantum/instance.py`, `quantum/exact.py` — the contagion model and exact
  enumeration ground truth, in Python (NumPy on Pyodide).
- `main.js` — builds the instance and exacts through the Python modules,
  renders the dashboard, orchestrates modes.
- `ui/runner.js` — live mode: Metropolis in JS; the QeMCMC proposal builds
  the Trotter circuit with the JS Qiskit API (`rzz` / `rz` / `rx`) and draws
  1 shot per step from the pre-created `backend`.
- `ui/network.js` — three.js interbank graph (tier rings, dependency edges,
  defaults flare red, click to select bailout targets).
- `ui/charts.js`, `ui/bailout.js`, `ui/stats.js` — canvas charts, the policy
  lab, and the shared Ising statistics (validated against the Python engine).
- `data/run.json` — the recorded reference run (4000 steps x 2 chains per
  arm, beta = 2.5), so the full results render instantly.

No external JavaScript dependencies: three.js is the only library used, as
bundled by the Qollab runtime.

## Repository

Full research codebase (Python engine, experiments, diagnostics):
`experiments/financial_contagion.py` reproduces the recorded run and
`experiments/export_qollab_data.py` regenerates `data/run.json`.

## Attribution

This effort is supported by Qollab & IonQ. MIT licensed.
