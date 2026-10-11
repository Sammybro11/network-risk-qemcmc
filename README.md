# Network Risk Analysis with Quantum-Enhanced Markov Chain Monte Carlo (QeMCMC)

![License](https://img.shields.io/badge/license-MIT-blue) ![Python](https://img.shields.io/badge/Python-3.14-informational) ![Built for](https://img.shields.io/badge/Qollab%20%C3%97%20IonQ-Hackathon-8A2BE2)

> **When a banking system is one shock from collapse, which bank do you save?**
> Classical Monte Carlo freezes near the tipping point and confidently recommends the wrong one. Quantum-enhanced MCMC tunnels between collapse regimes and ranks the rescue correctly, at a fraction of the iteration budget.

**Live dashboard:** <https://network-risk-qemcmc.vercel.app>
**Qollab project:** run it in your browser on <https://qollab.xyz> (public project, one-click **Run your code**)
**Code:** <https://github.com/Sammybro11/network-risk-qemcmc> (MIT)

---

## Contents

1. [The problem](#the-problem)
2. [The method, precisely](#the-method-precisely)
3. [Two economies, one sampler](#two-economies-one-sampler)
4. [Metrics glossary](#metrics-glossary)
5. [Showcase: time-to-accuracy at matched budget](#showcase-time-to-accuracy-at-matched-budget)
6. [The four scenarios in full](#the-four-scenarios-in-full)
7. [Repository layout](#repository-layout)
8. [How to run it](#how-to-run-it)
9. [References](#references)

---

## The problem

Systemic-risk networks, from interbank cross-holdings to road grids, sit near tipping points where they have two stable moods: everything stands, or a cascade takes everything down. The regulatory question is not "will it fail?" but who to rescue first under a fixed budget $K$.

That is a ranking problem over nodes, and the quantity that ranks interventions is the bailout susceptibility $\chi = \beta\,\mathrm{Cov}(\mathbf{z})$. It is an equilibrium quantity, so you cannot read it off the network topology; you have to sample the Boltzmann distribution at low temperature ($\beta = 2.5$). That is where classical Metropolis breaks down. Near a near-degenerate double well it freezes inside its starting basin, its covariance collapses toward zero, and its ranking degrades, sometimes to anti-correlated (Spearman $\rho < 0$):

![Tight Conglomerate Core: classical Metropolis starts anti-correlated, QeMCMC is correct from 4,000 steps](https://raw.githubusercontent.com/Sammybro11/network-risk-qemcmc/main/experiments/showcase/s1_conglomerate_core_convergence.png)

*Left: classical MH ranks the rescue targets backwards ($\rho \approx -0.8$) at short chain lengths; QeMCMC is above the correctness threshold from 4,000 steps. Right: relative error of the sampled susceptibility matrix $\chi$ vs exact enumeration.*

QeMCMC replaces the single-spin Metropolis proposal with a Trotterized quantum proposal that tunnels between basins and recovers $\chi$ with high fidelity where Metropolis collapses.

## The method, precisely

Every bank (or road segment) is a spin $z_i \in \{+1\ \text{healthy},\ -1\ \text{failed}\}$ with Ising energy

$$
E(\mathbf{z}) = \tfrac{1}{2}\,\mathbf{z}^\top J\,\mathbf{z} + \mathbf{h}^\top \mathbf{z},
\qquad
p(\mathbf{z}) \propto e^{-\beta E(\mathbf{z})}.
$$

Two samplers race on the same chain budget:

- **Classical arm:** single-spin Metropolis at inverse temperature $\beta$.
- **Quantum arm:** per step, build a Trotter circuit for

$$
H \;=\; (1-\gamma)\,\alpha\, H_{\text{prob}} \;+\; \gamma \sum_j X_j,
\qquad
\alpha = \frac{\lVert H_{\text{mix}}\rVert_F}{\lVert H_{\text{prob}}\rVert_F},
$$

  anchored at the current state; take 1 shot from the simulator; accept via the Metropolis ratio (the proposal is symmetric, so no Hastings correction is needed). The mixer weight $\alpha$ is set by Frobenius norms so $\gamma$ stays problem-size invariant.

The identity that turns sampling into policy is the fluctuation-dissipation relation:

$$
\frac{\partial \langle z_i \rangle}{\partial h_j} = -\beta\,\mathrm{Cov}(z_i, z_j) = -\chi_{ij},
\qquad
\mu_j = \frac{1}{n}\sum_i \chi_{ij}.
$$

The marginal utility of rescuing bank $j$, i.e. how much the whole system's health improves per unit of bailout dose $\omega$ at $j$, is the column mean of $\chi$. $\boldsymbol{\mu}$ is the bang-per-bailout ranking. A bailout is a field edit $h_j \to h_j - \omega$: it changes the economy, never the sampler, and the ranking is re-measured after every dose by the sequential (reactive) policy.

## Two economies, one sampler

**1. Financial contagion (EGJ cross-holdings model).** Banks in three tiers (core, intermediate, periphery) with cross-holdings $C$. All indirect ownership chains are folded into the dependency matrix $A = \widehat{C}(I - C)^{-1}$, and the network maps onto the Ising instance

$$
J = -\frac{\lambda}{4}\,(A + A^\top) \quad (\text{ferromagnetic: coupled banks fail together}),
\qquad \mathbf{h} = \text{vuln}\cdot\text{tier}.
$$

A rescue is a stabilizing field edit; quality is the post-rescue mean system health $m(S)$.

**2. Traffic congestion (VOC-normalized grid).** Road segments on an $L\times L$ grid; $z = +1$ free-flowing, $-1$ congested; the load field $\mathbf{h}$ is capacity-normalized (volume-over-capacity-like). Under VOC normalization, widening a road is the same field edit as bailing out a bank, so the identical machinery carries over. The showcase includes a traffic scenario to demonstrate this.

## Metrics glossary

| Metric | Definition | What it tells you |
| :---- | :---- | :---- |
| $\chi$ relative error | $\lVert \chi_{\text{sampler}} - \chi_{\text{exact}}\rVert_F / \lVert \chi_{\text{exact}}\rVert_F$ | How far the sampled susceptibility matrix is from exact $2^n$ Boltzmann enumeration |
| Spearman $\rho(\boldsymbol{\mu})$ | Rank correlation of sampler $\boldsymbol{\mu}$ vs exact $\boldsymbol{\mu}$ | The policy-relevant metric: does the sampler rank rescue targets correctly? |
| $m(S)$ | Post-intervention mean system health, re-enumerated exactly under the bailout/widening field edit | How good the chosen rescue set actually is |
| Regret | $R(S) = \max(0,\; m_{\text{opt}} - m(S))$ | What picking the wrong rescue set costs, vs the exhaustive optimum |
| Time-to-accuracy | Smallest step budget with $\rho \ge 0.9$ and relerr $\le 0.1$ | How fast each sampler becomes trustworthy at a matched iteration budget |
| ESS/step | Effective sample size per chain step (Geyer initial positive sequence) | Sample quality per step |
| Acceptance rate | Fraction of accepted moves | Mechanism diagnostics (whole-config quantum proposals are not comparable to Metropolis's) |
| Static baselines | Strength (col-sum of $A$), eigenvector centrality, DebtRank, cascade closure | Structure-only rankings that scale to large $N$ but are $\beta$-blind; they cannot see temperature or tipping |

Ground truth is exact $2^n$ Boltzmann enumeration (chunked up to $n \le 22$), so every headline number is checked against exact enumeration rather than another heuristic.

## Showcase: time-to-accuracy at matched budget

Four scenarios, each built around the same failure mode of classical sampling: freezing in one basin near a tipping point. Both samplers get the same iteration budget; the question is who ranks the rescue targets correctly first.

![Time-to-accuracy across all four scenarios](https://raw.githubusercontent.com/Sammybro11/network-risk-qemcmc/main/experiments/showcase/summary_time_to_accuracy.png)

| Scenario | Story | QeMCMC correct from | Classical MH correct from | Gap |
| :---- | :---- | :---- | :---- | :---- |
| Tight Conglomerate Core (finance, $n{=}12$) | Core banks prop each other up; the system has two moods | **4,000** steps | 12,000 steps | **3.0×** |
| Fragile Periphery, Hidden Amplifier (finance, $n{=}12$) | The dangerous bank is a mid-tier one | **12,000** steps | 16,000 steps | 1.3× |
| Rival Alliances (finance, $n{=}12$) | Frustrated guarantees; rugged landscape | 2,000 steps | 2,000 steps | none (tie) |
| Rush-Hour Gridlock (traffic, $n{=}9$) | Closing the wrong street jams somewhere else | **8,000** steps | 20,000 steps | **2.5×** |

## The four scenarios in full

Each scenario with its convergence figure and the numbers behind it:

### 1. Tight Conglomerate Core (finance, $n{=}12$)

Six core banks guarantee each other's debt so tightly that the system has two stable moods: everything stands, or the whole core falls together. A simulation that only explores one mood will confidently name the wrong bank to bail out.

The convergence figure at the top of this README shows this scenario. Metropolis ranks the rescue targets backwards ($\rho \approx -0.8$) at short chain lengths. QeMCMC is correct from 4,000 steps; Metropolis needs 12,000, a 3.0× gap. At full length QeMCMC's susceptibility matrix is nearly exact: relative error 0.008, $\rho$ +0.958.

### 2. Fragile Periphery, Hidden Amplifier (finance, $n{=}12$)

The dangerous bank here sits mid-network and multiplies whatever hits it. Vulnerability that only shows up under stress is invisible to a frozen sampler.

![Hidden Amplifier convergence](https://raw.githubusercontent.com/Sammybro11/network-risk-qemcmc/main/experiments/showcase/s2_hidden_amplifier_convergence.png)

QeMCMC is correct from 12,000 steps, Metropolis from 16,000 (1.3×). Metropolis's ranking also degrades between 12,000 and 16,000 steps ($\rho$ drops from 0.965 to 0.916), a sign it never fully escapes its starting basin. Both samplers end up recommending the same rescue sets; the difference is how fast the ranking becomes trustworthy.

### 3. Rival Alliances (finance, $n{=}12$)

Two alliances whose guarantees cancel each other out. Frustrated loops mean no arrangement pleases everyone, so the energy landscape is rugged for every method.

![Rival Alliances convergence](https://raw.githubusercontent.com/Sammybro11/network-risk-qemcmc/main/experiments/showcase/s3_rival_alliances_convergence.png)

Both samplers rank correctly from the shortest prefix: no time-to-accuracy gap here. When the landscape is easy, the quantum proposal adds nothing.

### 4. Rush-Hour Gridlock (traffic, $n{=}9$)

A city grid at rush hour, one closure from gridlock. Close the wrong street and traffic reroutes, jamming somewhere else. The worst street is only visible once the sampler has seen both the free-flowing and the gridlocked regime.

![Rush-Hour Gridlock convergence](https://raw.githubusercontent.com/Sammybro11/network-risk-qemcmc/main/experiments/showcase/s4_rush_hour_convergence.png)

QeMCMC sits at $\rho \approx +1.0$ from 4,000 steps and meets the time-to-accuracy criteria from 8,000. Metropolis is negatively correlated through 12,500 steps, so acting on its ranking would close the wrong streets. At full length: QeMCMC relative error 0.048 with $\rho$ +1.000; Metropolis 0.067 with +0.967.

## Repository layout

| Path | What it is |
| :---- | :---- |
| `src/risk_qemcmc/` | The Python package: `problems/` (Ising instances + exact ground truth), `algorithms/` (MCMC driver, classical proposals, the quantum `QeProposal`), `compile/` (Qiskit Trotter circuit construction), `analysis/` (pure-numpy diagnostics: Geyer ESS, energy bias, susceptibility) |
| `experiments/` | Lab CLIs (`financial_contagion.py`, `traffic_congestion.py`), the showcase protocol (`scen_s*.py` + `scenarios_common.py`), preflight gates that lock scenario parameters before long runs, and the renderer that turns result JSONs into figures + story markdown |
| `experiments/showcase/` | The four-scenario showcase: figures + `STORY.md` |
| `qollab_lab/` | The judge-runnable Qollab entry, one Run button, two parts (see below) |
| `webapp/` | The 100% client-side "Contagion Atlas" dashboard ([live](https://network-risk-qemcmc.vercel.app)): Financial Contagion & Systemic Risk (interbank topology, sampler race, ranking fidelity, an interactive bailout laboratory scored against exact re-enumeration) and Max-Cut Graph Optimization (the same machinery on a different problem) |
| `tests/` | `uv run pytest`: FFT autocorrelation, ESS sanity, sampler-$\chi$ vs exact enumeration, enumeration barrier |

**Inside `qollab_lab/`:** Part 1 renders the full recorded showcase gallery instantly (network maps, basin histograms, chain traces, flip-size histograms, convergence ladders, ranking bars, cross-scenario summary). Part 2 rebuilds the Rush-Hour instance and re-runs it live on the IonQ simulator chosen in the Select QPU dialog: exact truth by $2^9$ enumeration, then a Metropolis vs QeMCMC race, then the widening intervention study. The default 8,000 steps matches the recorded QeMCMC time-to-accuracy (about 80 s), so you watch the quantum ranking land correct while classical MH is still lost.

## How to run it

**On Qollab:** open the published project and press **Run your code**. Part 1 (recorded gallery) renders instantly; Part 2 (live Rush-Hour race, about 80 s at defaults) runs on the IonQ simulator you pick in the Select QPU dialog. Form knobs move the instance around its tipping point: $\beta$, vuln, $\lambda$, frustration, steps, chains, burn-in, quantum $\gamma$/time, seed. Regenerate uploadable bundles with:

```bash
uv run python scripts/package_qollab.py
```

**Locally** (uv-managed, Python 3.14):

```bash
uv sync                                            # install dependencies
uv run pytest                                      # test suite
uv run python experiments/financial_contagion.py   # finance lab CLI
uv run python experiments/traffic_congestion.py    # traffic lab CLI
```

**Webapp:** the dashboard deploys automatically from the repo to Vercel (`vercel.json`, zero build steps). Full instructions: [`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md).

## References

- D. Layden et al., *Quantum-enhanced Markov chain Monte Carlo*, Nature **619**, 282 (2023) — [arXiv:2203.12497](https://arxiv.org/abs/2203.12497)
- N. Ferguson & P. Wallden — [arXiv:2405.04247](https://arxiv.org/abs/2405.04247)
- EGJ cross-holdings contagion model — [arXiv:2609.17415](https://arxiv.org/abs/2609.17415)
- Road-network congestion-as-Ising framing — [arXiv:2605.03879](https://arxiv.org/abs/2605.03879); congestion-cost coupling (IBM/Ford) — [arXiv:2504.08275](https://arxiv.org/abs/2504.08275); congestion transitions on graphs — [arXiv:2405.16100](https://arxiv.org/abs/2405.16100)
- DebtRank baseline — Battiston et al., [arXiv:1504.01857](https://arxiv.org/abs/1504.01857)
- Max-Cut QAOA (webapp module) — Farhi, Goldstone, Gutmann, [arXiv:1411.4028](https://arxiv.org/abs/1411.4028)

---

*This effort is supported by Qollab & IonQ.* MIT licensed.
