# network-risk-qemcmc

Analysis of Risk in Complex Systems with Pairwise Correlated Failures by Utilizing Quantum-Enhanced Markov Chain Monte Carlo (QeMCMC).

Developed for the IonQ / Qollab Hackathon.

---

## Overview

Any system whose risk is dominated by **pairwise correlated failure** maps onto the same Ising Hamiltonian `H(z) = ½ zᵀJz + hᵀz`: nodes that can fail, couplings along which failure propagates, a longitudinal field for intrinsic vulnerability, and a temperature for aggregate stress. Power grids, supply chains, epidemics, interdependent infrastructure, breach propagation and ecological tipping cascades all have this structure — only the reading of `J_ij` changes. A shock enters the same way in every case, as a diagonal edit: a field kick `Δh_i`, a coupling change, or a pinned failed seed; an intervention is the same edit with the opposite sign, `h_j → h_j − ω`.

Interbank cross-holdings and road-traffic grids are the two instantiations implemented here, chosen because both have published classical baselines to check against.

Near a tipping point the equilibrium distribution has two deep basins. Classical Metropolis MCMC freezes in whichever one it started in, giving near-zero covariance estimates and anti-correlated policy rankings — so the intervention ranking built on that covariance is wrong.

This repository implements **Quantum-Enhanced MCMC (QeMCMC)**:
- **Trotterized Quantum Proposal**: Evolving the state under $(1-\gamma)\alpha H_{\text{prob}} + \gamma \sum X_j$ enables quantum tunneling between metastable basins.
- **Intervention Susceptibility**: Reconstructs the fluctuation-dissipation response matrix $\chi = \beta \operatorname{Cov}(z)$, whose column mean *is* the marginal utility of intervening at node $j$ — the quantity a frozen classical chain gets wrong. A bailout and a road widening are the same field edit, so the same ranking code serves both.
- **Time to accuracy, honestly stated**: Given a large enough step budget both samplers converge. The claim is the iteration-budget gap — QeMCMC reaches a correct intervention ranking in 2–8k steps where Metropolis needs 8–20k — measured on a simulator, so no wall-clock speedup is claimed.
- **Scientific Workbench**: Modular web dashboard, one module per recorded showcase scenario (three financial contagion networks and a rush-hour road grid), each replaying a 20,000-step × 4-chain run and re-runnable live in the browser.

---

## Deployment & Running

Full instructions can be found in [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md).

### 1. Host on Vercel
The repository includes [`vercel.json`](./vercel.json) for zero-configuration deployment of the interactive web platform:
- Import `network-risk-qemcmc` on [Vercel](https://vercel.com) and click **Deploy**.
- The static webapp in `webapp/` is automatically deployed globally with zero build steps or server dependencies.

### 2. Run in Qollab (qollab.xyz)
Generate ready-to-upload bundles with:
```bash
uv run python scripts/package_qollab.py
```
- **Python Lab (`dist/qollab_lab.zip`)**: Run the pure-Python experiment using Qollab's injected IonQ simulator hardware backend.
- **Interactive Web App (`dist/qollab_webapp.zip`)**: Run the live interactive dashboard inside Qollab's browser canvas.

---

## Local Development

This project uses `uv` for dependency management:

```bash
# Install dependencies
uv sync

# Run tests
uv run pytest

# Run experiments
uv run python experiments/financial_contagion.py
uv run python experiments/report_plots.py
uv run python experiments/visualize_results.py

# Run web app locally
python3 -m http.server 8000 --directory webapp
```

---

## License
MIT
