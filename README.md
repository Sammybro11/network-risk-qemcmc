# Network Risk Analysis with Quantum-Enhanced Markov Chain Monte Carlo (QeMCMC)

![License](https://img.shields.io/badge/license-MIT-blue) ![Python](https://img.shields.io/badge/Python-3.14-informational) ![Built for](https://img.shields.io/badge/Qollab%20%C3%97%20IonQ-Hackathon-8A2BE2)

> **When a banking system is one shock from collapse, which bank do you save?**
> Classical Monte Carlo freezes near the tipping point and confidently recommends the wrong one. Quantum-enhanced MCMC tunnels between collapse regimes and ranks the rescue correctly — from a fraction of the iteration budget.

**Live dashboard:** <https://network-risk-qemcmc.vercel.app>
**Qollab project:** run it in your browser on <https://qollab.xyz> (public project, one-click **Run your code**)

---

## Contents

1. [The problem](#the-problem)
2. [The method, precisely](#the-method-precisely)
3. [Two economies, one sampler](#two-economies-one-sampler)
4. [Metrics glossary](#metrics-glossary)
5. [Showcase: time-to-accuracy at matched budget](#showcase-time-to-accuracy-at-matched-budget)
6. [Repository layout](#repository-layout)
7. [How to run it](#how-to-run-it)
8. [References](#references)

---

## The problem

Systemic-risk networks — interbank cross-holdings, road grids — sit near **tipping points** where they have two stable moods: everything stands, or a cascade takes everything down. The regulatory question is not *"will it fail?"* but:

> **Who do you rescue first under a fixed budget $K$?**

That is a *ranking problem over nodes*, and the quantity that ranks interventions is the **bailout susceptibility** $\chi = \beta\,\mathrm{Cov}(\mathbf{z})$ — an *equilibrium* quantity you cannot read off the network topology. You must sample the Boltzmann distribution at low temperature ($\beta = 2.5$), and that is exactly where classical Metropolis breaks: near a near-degenerate double well it **freezes inside its starting basin**, its covariance collapses toward zero, and its ranking degrades — sometimes to *anti*-correlated (Spearman $\rho < 0$):

![Tight Conglomerate Core: classical Metropolis starts anti-correlated, QeMCMC is correct from 4,000 steps](https://raw.githubusercontent.com/Sammybro11/network-risk-qemcmc/main/experiments/showcase/s1_conglomerate_core_convergence.png)

*Left: classical MH ranks the rescue targets **backwards** ($\rho \approx -0.8$) at short chain lengths; QeMCMC is above the correctness threshold from 4,000 steps. Right: relative error of the sampled susceptibility matrix $\chi$ vs exact enumeration.*

**QeMCMC** replaces the single-spin Metropolis proposal with a **Trotterized quantum proposal** that tunnels between basins, recovering $\chi$ with high fidelity where Metropolis collapses.

## The method, precisely

Every bank (or road segment) is a spin $z_i \in \{+1\ \text{healthy},\ -1\ \text{failed}\}$ with Ising energy

$$
E(\mathbf{z}) = \tfrac{1}{2}\,\mathbf{z}^\top J\,\mathbf{z} + \mathbf{h}^\top \mathbf{z},
\qquad
p(\mathbf{z}) \propto e^{-\beta E(\mathbf{z})}.
$$

Two samplers race on the *same* chain budget:

- **Classical arm:** single-spin Metropolis at inverse temperature $\beta$.
- **Quantum arm:** per step, build a Trotter circuit for

$$
H \;=\; (1-\gamma)\,\alpha\, H_{\text{prob}} \;+\; \gamma \sum_j X_j,
\qquad
\alpha = \frac{\lVert H_{\text{mix}}\rVert_F}{\lVert H_{\text{prob}}\rVert_F},
$$

  anchored at the current state; take **1 shot** from the simulator; accept via the Metropolis ratio (the proposal is symmetric, so no Hastings correction is needed). The mixer weight $\alpha$ is set by Frobenius norms so $\gamma$ stays problem-size invariant.

The **key identity** that turns sampling into policy is the fluctuation–dissipation relation:

$$
\frac{\partial \langle z_i \rangle}{\partial h_j} = -\beta\,\mathrm{Cov}(z_i, z_j) = -\chi_{ij},
\qquad
\mu_j = \frac{1}{n}\sum_i \chi_{ij}.
$$

The marginal utility of rescuing bank $j$ — *how much does the whole system's health improve per unit of bailout dose $\omega$ at $j$* — **literally is the column mean of $\chi$**. $\boldsymbol{\mu}$ is the bang-per-bailout ranking. A bailout is a field edit $h_j \to h_j - \omega$: it changes the economy, never the sampler; the ranking is re-measured after every dose by the sequential (reactive) policy.

## Two economies, one sampler

**1. Financial contagion (EGJ cross-holdings model).** Banks in three tiers (core / intermediate / periphery) with cross-holdings $C$. All indirect ownership chains are folded into the dependency matrix $A = \widehat{C}(I - C)^{-1}$, and the network maps onto the Ising instance

$$
J = -\frac{\lambda}{4}\,(A + A^\top) \quad (\text{ferromagnetic: coupled banks fail together}),
\qquad \mathbf{h} = \text{vuln}\cdot\text{tier}.
$$

Rescue = stabilizing field edit; quality = post-rescue mean system health $m(S)$.

**2. Traffic congestion (VOC-normalized grid).** Road segments on an $L\times L$ grid; $z = +1$ free-flowing, $-1$ congested; the load field $\mathbf{h}$ is capacity-normalized (volume-over-capacity-like). Under VOC normalization, **widening a road is literally the same field edit as bailing out a bank** — the identical machinery carries over, which is the point: this is a general tipping-point sampler, not a finance gimmick.

## Metrics glossary

| Metric | Definition | What it tells you |
| :---- | :---- | :---- |
| $\chi$ relative error | $\lVert \chi_{\text{sampler}} - \chi_{\text{exact}}\rVert_F / \lVert \chi_{\text{exact}}\rVert_F$ | How far the sampled susceptibility matrix is from exact $2^n$ Boltzmann enumeration |
| Spearman $\rho(\boldsymbol{\mu})$ | Rank correlation of sampler $\boldsymbol{\mu}$ vs exact $\boldsymbol{\mu}$ | **The policy-relevant metric** — does the sampler rank rescue targets correctly? |
| $m(S)$ | Post-intervention mean system health, re-enumerated exactly under the bailout/widening field edit | How good the chosen rescue set actually is |
| Regret | $R(S) = \max(0,\; m_{\text{opt}} - m(S))$ | Cost of picking the wrong rescue set, vs the exhaustive optimum |
| Time-to-accuracy | Smallest step budget with $\rho \ge 0.9$ and relerr $\le 0.1$ | How fast each sampler becomes trustworthy at a *matched iteration budget* |
| ESS/step | Effective sample size per chain step (Geyer initial positive sequence) | Sample quality per step |
| Acceptance rate | Fraction of accepted moves | Mechanism diagnostics (whole-config quantum proposals are not comparable to Metropolis's) |
| Static baselines | Strength (col-sum of $A$), eigenvector centrality, DebtRank, cascade closure | Structure-only rankings that scale to large $N$ but are $\beta$-blind — they cannot see temperature or tipping |

Ground truth is exact $2^n$ Boltzmann enumeration (chunked up to $n \le 22$), so every headline number is checked against **truth**, not against another heuristic.

## Showcase: time-to-accuracy at matched budget

Four named real-world scenarios, each a different story wrapped around the one honest mechanism (basin freezing). Both samplers get the **same iteration budget**; the question is who ranks the rescue targets correctly *first*.

![Time-to-accuracy across all four scenarios](https://raw.githubusercontent.com/Sammybro11/network-risk-qemcmc/main/experiments/showcase/summary_time_to_accuracy.png)

| Scenario | Story | QeMCMC correct from | Classical MH correct from | Gap |
| :---- | :---- | :---- | :---- | :---- |
| Tight Conglomerate Core (finance, $n{=}12$) | Core banks prop each other up; the system has two moods | **4,000** steps | 12,000 steps | **3.0×** |
| Fragile Periphery, Hidden Amplifier (finance, $n{=}12$) | The dangerous bank is not the biggest one | **12,000** steps | 16,000 steps | 1.3× |
| Rival Alliances (finance, $n{=}12$) | Frustrated guarantees; rugged landscape | 2,000 steps | 2,000 steps | — (no gap) |
| Rush-Hour Gridlock (traffic, $n{=}9$) | Closing the wrong street jams somewhere else | **8,000** steps | 20,000 steps | **2.5×** |

And the traffic case tells the same story with an $n{=}9$ grid — QeMCMC sits at $\rho \approx +1.0$ from 4,000 steps while Metropolis is *negatively* correlated through 12,500:

![Rush-Hour Gridlock: QeMCMC correct from 4k steps, Metropolis anti-correlated until 15k](https://raw.githubusercontent.com/Sammybro11/network-risk-qemcmc/main/experiments/showcase/s4_rush_hour_convergence.png)

Full-length fidelity where it matters most: S1 QeMCMC relerr **0.008** / $\rho$ **+0.958** vs Metropolis 0.018 / +0.972 — and on the frozen instance Metropolis measures $\chi$ with **negative** Spearman $\rho$, i.e. confidently the wrong ranking. The full scenario-by-scenario story is in [`experiments/showcase/STORY.md`](./experiments/showcase/STORY.md).

## Repository layout

| Path | What it is |
| :---- | :---- |
| `src/risk_qemcmc/` | The Python package: `problems/` (Ising instances + exact ground truth), `algorithms/` (MCMC driver, classical proposals, the quantum `QeProposal`), `compile/` (Qiskit Trotter circuit construction), `analysis/` (pure-numpy diagnostics: Geyer ESS, energy bias, susceptibility) |
| `experiments/` | Lab CLIs (`financial_contagion.py`, `traffic_congestion.py`), the six-scenario showcase protocol (`scen_s*.py` + `scenarios_common.py`), preflight gates that lock scenario parameters *before* long runs, and the renderer that turns result JSONs into figures + story markdown |
| `experiments/showcase/` | The four-scenario showcase: figures + `STORY.md` reproduced above |
| `qollab_lab/` | The judge-runnable Qollab entry — one Run button, two parts (see below) |
| `webapp/` | The 100 %-client-side "Contagion Atlas" dashboard ([live](https://network-risk-qemcmc.vercel.app)): Financial Contagion & Systemic Risk (interbank topology, sampler race, ranking fidelity, interactive bailout laboratory scored against exact re-enumeration) and Max-Cut Graph Optimization (proving the machinery is problem-agnostic) |
| `tests/` | `uv run pytest`: FFT autocorrelation, ESS sanity, sampler-$\chi$ vs exact enumeration, enumeration barrier |

**Inside `qollab_lab/`:** **Part 1** renders the full recorded showcase gallery instantly (network maps, basin histograms, chain traces, flip-size histograms, convergence ladders, ranking bars, regret curves for static *and* sequential policies, cross-scenario summary). **Part 2** rebuilds the Rush-Hour instance and re-runs it **live** on the IonQ simulator chosen in the Select QPU dialog — exact truth by $2^9$ enumeration, then a Metropolis vs QeMCMC race, then the widening intervention study. Default 8,000 steps ≈ the recorded QeMCMC time-to-accuracy (~80 s), so you watch the quantum ranking land correct while classical MH is still lost.

## How to run it

**On Qollab (recommended for judges):** open the published Qollab project and press **Run your code** — Part 1 (recorded gallery) renders instantly; Part 2 (live Rush-Hour race, ~80 s at defaults) runs on the selected IonQ simulator. Form knobs move the instance around its tipping point: $\beta$, vuln, $\lambda$, frustration, steps, chains, burn-in, quantum $\gamma$/time, seed. Regenerate uploadable bundles with:

```bash
uv run python scripts/package_qollab.py
```

**Locally** (uv-managed, Python 3.14):

```bash
uv sync                                            # install dependencies
uv run pytest                                      # test suite
uv run python experiments/financial_contagion.py   # finance lab CLI
uv run python experiments/traffic_congestion.py    # traffic lab CLI
python3 -m http.server 8000 --directory webapp     # dashboard locally
```

**Webapp:** deployed automatically from the repo to Vercel (`vercel.json`, zero build steps). Full instructions: [`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md).

## References

- D. Layden et al., *Quantum-enhanced Markov chain Monte Carlo*, Nature **619**, 282 (2023) — [arXiv:2203.12497](https://arxiv.org/abs/2203.12497)
- N. Ferguson & P. Wallden — [arXiv:2405.04247](https://arxiv.org/abs/2405.04247)
- EGJ cross-holdings contagion model — [arXiv:2609.17415](https://arxiv.org/abs/2609.17415)
- Road-network congestion-as-Ising framing — [arXiv:2605.03879](https://arxiv.org/abs/2605.03879); congestion-cost coupling (IBM/Ford) — [arXiv:2504.08275](https://arxiv.org/abs/2504.08275); congestion transitions on graphs — [arXiv:2405.16100](https://arxiv.org/abs/2405.16100)
- DebtRank baseline — Battiston et al., [arXiv:1504.01857](https://arxiv.org/abs/1504.01857)
- Max-Cut QAOA (webapp module) — Farhi, Goldstone, Gutmann, [arXiv:1411.4028](https://arxiv.org/abs/1411.4028)

---

*This effort is supported by Qollab & IonQ.* MIT licensed.
