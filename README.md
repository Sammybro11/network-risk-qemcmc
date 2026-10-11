# network-risk-qemcmc

Analysis of Risk in Complex Systems with Pairwise Correlated Failures by Utilizing Quantum-Enhanced Markov Chain Monte Carlo (QeMCMC).

Developed for the IonQ / Qollab Hackathon.

---

## Overview

In systemic risk networks (such as interbank cross-holdings or road traffic grids), cascading failures can trigger severe tipping points. Classical Metropolis Markov Chain Monte Carlo (MCMC) frequently freezes in deep local potential wells near healthy or congested states, leading to near-zero covariance estimates and anti-correlated policy rankings.

This repository implements **Quantum-Enhanced MCMC (QeMCMC)**:
- **Trotterized Quantum Proposal**: Evolving the state under $(1-\gamma)\alpha H_{\text{prob}} + \gamma \sum X_j$ enables quantum tunneling between metastable basins.
- **Bailout Susceptibility**: Reconstructs the fluctuation-dissipation response matrix $\chi = \beta \operatorname{Cov}(z)$ with high rank fidelity (Spearman $> 0.85$) where classical Metropolis collapses.
- **Scientific Workbench (Contagion Atlas V2)**: Modular web dashboard supporting both financial contagion cascades and combinatorial graph optimization (Max-Cut).

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
