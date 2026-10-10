# QeMCMC for Financial Contagion — static webapp

Browser-only companion to the `risk_qemcmc` Python package: a tiered
interbank contagion network posed as an Ising model, where a quantum
proposal (QeMCMC) races classical Metropolis to learn the
bailout-susceptibility landscape, and a policy lab scores rescue budgets
by exact enumeration.

Pure JavaScript, no build step, no backend — deployable to GitHub Pages.

## What it shows

- **Replay of a recorded run** (`data/run.json`): QeMCMC vs Metropolis at
  beta = 2.5, 4000 steps x 2 chains per arm, burn-in 500. The recorded
  reference run ships three headline numbers: susceptibility relative
  error 0.018 (quantum) vs 0.987 (Metropolis), rank fidelity (Spearman
  against exact magnetisation) +0.874 vs -0.741, and regret 0.005 vs 0.299
  for the K=1 bailout decision.
- **Live race in your browser**: Metropolis runs in plain JS; the quantum
  proposal is the same Trotterised circuit as
  `risk_qemcmc.compile.trotter`, simulated with a small exact statevector
  engine (4,096 amplitudes): 1 shot per step, sampled from the true final
  state probabilities.
- **2D interbank network**: concentric tier rings (core, intermediate,
  periphery) with dependency edges; nodes flare red as defaults spread.
- **Bailout policy lab**: pick up to K banks, the app re-enumerates the
  exact Boltzmann distribution under your intervention and reports regret
  against the exhaustive optimum.

## Data flow

`data/run.json` carries both the recorded trajectories and the instance
matrices (`J`, `h`, `A`, tiers, baselines), so every number on the page is
derived from one file. The exact ground truth is re-enumerated in the
browser at load; it reproduces the Python values to ~1e-14, and the JS
Trotter statevector matches qiskit's probability vector to 8e-16 (total
variation distance). The instance was built with
`risk_qemcmc.problems.financial_instance(n=12, seed=42, lam=6.0, vuln=0.0)`.

## Running locally

Any static file server works, e.g.:

```bash
python3 -m http.server -d webapp 8000
# open http://localhost:8000
```

ES modules are used, so opening `index.html` via `file://` does not work.

## Conventions

Spins are ±1 with bit mapping `bit = (1 - z) // 2`, so `z = +1` is qubit
state |0>; the statevector's amplitude index keeps qubit `i` at bit position
`i`, so no endianness fix-ups are needed anywhere in the JS.

Ising conventions and the QeMCMC proposal follow Layden et al. (Nature 619,
282, 2023); the contagion model follows Tomar et al. (arXiv:2609.17415);
the DebtRank baseline follows Battiston et al. (arXiv:1504.01857).
