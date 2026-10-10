# AGENTS.md

Research codebase: quantum-enhanced Markov Chain Monte Carlo (QeMCMC) for network
risk / systemic-default analysis (contagion Ising model). Following the proposal
scheme of Layden et al. (Nature 619, 282 (2023), arXiv:2203.12497) and
Ferguson & Wallden (arXiv:2405.04247).

## Project setup

- uv-managed Python package, `src/` layout, Python **3.14** (`.python-version`, `requires-python = ">=3.14"`).
- Deps: numpy, qiskit + qiskit-aer (quantum simulation), matplotlib (report plots), tqdm. Diagnostics are pure numpy (Geyer ESS); arviz/arviz_stats were removed (compiled, no wasm wheels — they blocked the Pyodide/qollab browser path).

### Commands

```bash
uv sync                          # install deps into .venv
uv run python ...                # run anything inside the project env
uv run risk-qemcmc               # CLI entry point; currently a stub printing hello (risk_qemcmc/__init__.py:main)
uv run pytest                    # tests/ — diagnostics (ESS/autocorr/susceptibility), enumeration barrier
```

There is no lint/typecheck config, no Makefile, no CI.

## Architecture / data flow

Four subpackages under `src/risk_qemcmc/`, wired as a linear pipeline:

1. **`problems/`** — problem instances and ground truth
   - `qubo.py`: generic Ising instances. Convention: `E(z) = 0.5 z^T J z + h^T z` with spins `z_i ∈ {−1, +1}`. `J` is a full symmetric matrix; asymmetric input (`sk_instance`) is symmetrized via upper triangle + transpose.
   - `network.py`: the actual risk-network instances — core-periphery weighted adjacency, ferromagnetic `J = −coupling·A` (defaults cluster), healthy bias `h = −health`. `exact_cascade` gives exact P(#defaults ≥ k) by 2^n enumeration.
2. **`algorithms/`** — sampling
   - `mcmc.py`: `MCMC` driver. `step()` energy change is computed with full `ising_energy` recomputation (not incremental), fine at small n but a scaling consideration.
   - `proposals.py`: classical proposals — callables with signature `(state: np.ndarray, rng: np.random.Generator) -> np.ndarray`. `MCMC.__init__(propose=...)` swaps proposals freely; this duck-typed interface is how the quantum proposal plugs in.
   - `qe_proposal.py`: `QeProposal` is the quantum proposal, same `(z, rng) -> z'` callable. Per step it draws gamma and t (uniformly over ranges if tuples), builds a Trotter circuit anchored at the current state, takes **1 shot** from Aer. Accepts `simulator=` to inject any backend with the `run(circuit, shots).result().get_counts()` interface — on qollab this is the runtime-injected `backend` global; when omitted it lazily constructs `AerSimulator(max_parallel_threads=1)` (lazy so the qollab Pyodide env, which has no qiskit-aer wheel, never imports it).
3. **`compile/`** — circuit construction (`trotter.py`): builds `Qiskit` circuits for H = (1−γ)·α·H_prob + γ·ΣX, with Frobenius-norm α = ||H_mix||_F/||H_prob||_F so γ is problem-size invariant. `measure=False` returns an unmeasured circuit so a Statevector/density-matrix sim can read the full distribution.
4. **`analysis/`** — `Diagnostics` wraps an `MCMCResult`: ESS (Geyer initial positive sequence on the FFT autocorrelation), autocorrelation, energy bias/stderr vs. exact reference, post-selection rate, ESS per shot (the quantum-vs-classical cost metric). Pure numpy — arviz was removed (note: ESS values are plain Geyer, no rank-normalization, so they shift slightly vs. old arviz numbers). The old `rhat()` had no callers and was dropped.

Result plumbing: all sampling returns `MCMCResult` (states/energies/accepted arrays; shot-count fields `total_shots`, `kept_shots`, `keep_rate`, `discards` are only populated for quantum/proposal-with-shots runs — `total_shots_or_steps` and `post_selection_rate` handle both cases). Diagnostics consume `MCMCResult` polymorphically.

## Financial contagion model (`problems/finance.py`, arXiv:2609.17415 EGJ)

The financial layer maps an EGJ cross-holding network onto the Ising instance `(J, h)`:

- **Cross-holdings** `C` (`cross_holdings`): `C_ij` = fraction of j owned by i; tiered link
  density (core↔core dense, periphery sparse), columns capped at `1 - outside_min` so
  `I − C` is invertible.
- **Dependency matrix** (`dependency_matrix`): `A = Chat (I − C)⁻¹` with `Chat = diag(1 − colsum(C))`.
  This folds ALL indirect ownership chains into direct+indirect influence; `A_ij` is the quantity
  everything else consumes.
- **Ising mapping** (`financial_instance`): `J = −(λ/4)(A + Aᵀ)` (ferromagnetic in the
  `z = +1 healthy` convention ⇒ coupled banks fail together), `h_i = vuln × tier` (periphery
  1.2, core 0.8; positive field biases toward default).
- **Susceptibility** (`analysis/diagnostics.susceptibility`): `χ_ij = β·Cov(z_i, z_j)` from chain
  samples; exact truth via `qubo.exact_susceptibility`. Key identity: `∂⟨z_i⟩/∂h_j = −β·Cov`
  (fluctuation–dissipation), so **the bailout marginal utility d⟨m⟩/dω_j literally is
  mean_i χ_ij** — μ_j = column mean of χ is the "bang-per-bailout" ranking. That's the whole
  reason the samplers exist: χ is an equilibrium quantity you cannot read off the network.
- **Bailout** (`apply_bailout`): rescue = stabilizing field `h_i → h_i − ω·b_i`; quality metric is
  post-rescue mean health `m(S) = mean exact_mean_spin(J, apply_bailout(...), β)`.
- **Policy** (`sequential_greedy`): reactive dosing — re-rank μ against the CURRENT field
  (h minus prior bailouts) before every dose; a static top-K ranking cannot represent the
  non-additive dosing structure (a periphery bank worthless alone can be the key second dose
  once a hub is stabilized). Sequential arms live in `experiments/financial_contagion.py` and
  `experiments/export_qollab_data.py` (`exact-seq` = truth re-ranked, `metro-seq`/`quantum-seq`
  re-run chains per dose; dose 1 reuses the race χ via a per-field cache).
- **Static baselines** (structure-only, scale to large N, β-blind): `strength_scores`
  (col-sum of A), `eigenvector_scores` (power iteration on A+Aᵀ), `debtrank_scores`
  (single (I−αW)⁻¹ solve, distress export), `cascade_closure` (deterministic seed flood under
  `A_ij > θ`). These never require an equilibrium distribution; that is both why they scale and
  why they cannot see temperature or tipping.

### Parameter regimes and what they do to the demo

| knob | effect |
| :---- | :---- |
| β | inverse temperature. High β (2.5) ⇒ two ordered basins, χ large, samplers must cross barriers; low β ⇒ spins nearly independent, χ ≈ 0, nobody distinguishes banks. |
| ω | bailout dose. Weak ω near the tipping point is where bailout ranking matters; large ω saturates (m ≈ +1 after one hub rescue) and regret collapses to ties. Bailouts never affect sampler dynamics — only m(S). |
| vuln | energy tilt `Σh = vuln·10.2` (n=12). The healthy-vs-failed energy gap is `2·Σh`; Boltzmann weight is `exp(−β·gap)`, so small-looking vuln is not small: vuln=0.05 ⇒ healthy basin ~7%, vuln=0.6 ⇒ ~10⁻¹⁷ (single deep well). |

**Regime lessons (validated empirically):**
- The validated showcase is the **degenerate double well** (vuln ≈ 0, β = 2.5): Metropolis
  freezes in its start basin (P(all-healthy) 0.67 at β=2.5 vs exact 0.34) so its χ collapses
  (relerr ~0.99, Spearman negative); the quantum proposal tunnels between basins (relerr ~0.02,
  basin occupancy 0.31 vs exact 0.34).
- At **vuln ≰ 0.05** the exact μ profile itself flattens (spread ~0.01): ranking becomes noise
  for EVERY sampler, and broadband quantum proposals under-sample the fine interior of the deep
  failed basin (χ relerr plateaus ~0.4 at 8000 steps). Do not demo there.
- A sampler reporting "high acceptance" while its energy trace never moves = whole-config
  proposal no-ops (the circuit re-sampled the input state, `dE = 0` counts as accepted) —
  quantum acceptance counters must not be compared to Metropolis's.
- Ground-truth ⟨E⟩ is a thermal AVERAGE, not the floor: chains sitting at the floor are
  under-sampling excited states, which is exactly what convergence-to-the-dashed-line measures.

### Sampler moves vs bailouts (different objects — never mix)

| operation | what it changes | when it happens |
| :---- | :---- | :---- |
| sampler step | the **state** `z`: one or many banks flip `+1 ↔ −1` (healthy ↔ failed) | every step of every chain |
| bailout | the **field** `h`: `h_j → h_j − ω` for rescued banks | never inside a chain; only between policy doses |

A sampler step rewrites the configuration of a FIXED economy (same J, h, β) and accepts via
`exp(−β·ΔE)`. A bailout edits the economy's parameters, changing the equilibrium distribution
itself — the consequence is only visible after re-running the sampler on the modified instance.
Keeping them separate is what makes χ meaningful: χ measured on the un-bailed equilibrium
predicts the response to a bailout (fluctuation–dissipation), and the sequential policy
re-measures χ on the new equilibrium after each dose. If bailouts were moves inside a chain,
the target distribution would shift under the sampler and χ would be garbage.

### Where the financial experiments live

- `experiments/financial_contagion.py`: lab CLI (adds `--fracs`); prints exact-vs-sampler χ
  metrics and the bailout table incl. `exact-seq`/`metro-seq`/`quantum-seq` rows.
- `experiments/export_qollab_data.py`: serializes the recorded run (arms, χ, μ, exact truth,
  statics, bailout table with sequential rows) to `qollab_app/data/run.json` (and the same
  schema powers `webapp/data/run.json`); `--fracs` available.
- Browser mirrors: `webapp/` (pure JS) and `qollab_app/` (Pyodide) re-implement enumeration,
  Metropolis, the Trotter circuit, χ/μ, and regret charts; webapp JSON is loaded by `main.js`
  with `drawRanking`/`drawRegret` consuming exactly the table rows above.

### Traffic congestion layer (`problems/traffic.py`, arXiv:2605.03879 framing)

Same (J, h) convention, same samplers, different economy: road segments on an L×L grid
(+ optional perimeter ring road). `z = +1` free-flowing, `−1` congested; the load field
`h_i = vuln·demand_i/capacity_i` is capacity-normalised (VOC-like), so **widening a segment
is literally a field edit** (`apply_widening` ≡ `apply_bailout`) and χ = β·Cov(z) is the
bang-per-widening ranking by the same fluctuation–dissipation identity. Flow coupling
`J = −(λ/4)(F + Fᵀ)` from per-neighbour demand shares `F_ij` (spillback: congestion agrees
along shared load). The influence matrix returned as `A` is `Fᵀ` (congestion at j propagates
upstream to i), which feeds the reused finance baselines (`strength_scores` = load centrality,
`eigenvector_scores`, `debtrank_scores`, `cascade_closure`).

- `experiments/traffic_congestion.py`: lab CLI mirroring `financial_contagion.py`
  (`--L`, `--lam`, `--vuln`, `--omega`, `--theta`, `--no-ring`); prints the same χ metrics
  and widening table incl. sequential rows. No export/webapp wiring yet.
- Validated regime: **λ = 2.0, vuln = 0.05, β = 2.5, ω = 0.5** (the CLI defaults). At λ = 6
  the network is so strongly coupled that m(S) depends only on the total field — every
  ranking ties, no demo. Near the tipping point placement matters and the quantum arm
  recovers the exact sequential dose order while Metropolis (frozen, acceptance ~0.07)
  misranks dose 1.
- `--vuln 0` gives the perfectly symmetric double well (exact m = 0): any dose breaks the
  tie and saturates m ≈ +1, so regret ties everywhere. Keep the small tilt on for the demo.
- The `ring`/`--no-ring` knob is a **no-op at L = 3** (the perimeter cycle coincides with
  the grid streets); it only adds new edges for L ≥ 4, which exceeds exact enumeration.

## Conventions and gotchas

- **Spin↔bit convention (easy to break):** spins are ±1, qubits are 0/1, mapped by `bit = (1 − z)//2` and `z = 1 − 2·bit`. `trotter_circuit` maps `z_i = +1 → |0⟩`, `−1 → |1⟩`. Aer's measured bitstring must be reversed (`[::-1]`) before converting to bits — see `QeProposal._propose_bits` (qiskit little-endian vs. spin-index order).
- **Coupling sign:** ferromagnetic couplings are `J_ij < 0` in the `0.5 zᵀJz` convention (defaults prefer agreement). `trotter_circuit` uses only `J[i, j]` for `i < j` and skips zero entries, and `mixer_weight` uses `np.triu(J, 1)` — so passing a half-matrix or reintroducing an extra `J + J.T` for already-symmetric matrices would double-count.
- **Symmetry assumption:** `QeProposal` relies on its proposal being symmetric (H_prob diagonal, H_mix real) so the MH ratio reduces to the Boltzmann factor; no Hastings-correction or Q evaluation exists in `MCMC.step`. If a new proposal is asymmetric, `MCMC` breaks correctness silently.
- **Shots budget:** quantum burn-in and thinning steps still consume simulator shots; `MCMCResult` shot-count fields exist for proposals that track them, but no current proposal does — `total_shots_or_steps` then falls back to chain steps.
- **Aer perf:** `AerSimulator(max_parallel_threads=1)` is deliberate — shots=1 makes OpenMP parallelism pure overhead, and parallel worker processes would otherwise thrash. Don't "fix" it.
- **Trotter dt guard:** pass **either** fixed `r` **or** fixed `delta_t` (not both; `ValueError`); dt outside [0.1, 2.0] triggers a `warnings.warn` (not an error). Default `delta_t = 0.8`.
- **Exact reference values** (`exact_moments`, `exact_cascade`) enforce `n ≤ 20` (or `< 21`) with `assert` — enumeration is 2^n. Raised from 16 for headroom; the dashboard UI still caps n at 16 because the budget-OPT subset search is C(n,K) × 2^n and explodes regardless. Do not remove the assert; validate scaling differently.
- **RNG:** everything takes `np.random.Generator`; use `np.random.default_rng(seed)`. Instances are seeded via (`n`, `seed`) — `risk_network`'s structure depends only on those two.
- Slide comments/code style: short docstrings with a purpose; empty `__init__.py`s; one class/dataclass or a few related functions per file.

## Qollab lab (`qollab_lab/`, qollab Python project)

Minimal hackathon entry (idea: `docs/ideas/qemcmc-dashboard.md`; the JS-project
route is documented — and abandoned — in `dashboard/CHANGELOG.md`): a
top-level `main.py` (qollab's Python-project entry), vendored package modules
under `py/` (same drift-check discipline as `dashboard/py/`), and console
output with matplotlib SVG figures. The Run-settings form is auto-generated
from `main()`'s strictly-annotated signature; the quantum arm samples 1
shot/step from the injected `backend` global via `QeProposal(simulator=...)`.
Key runtime facts: Pyodide Python 3.14 + qiskit 2.x + numpy/matplotlib
bundled; no qiskit-aer wheel (hence the lazy import); `plt.show()` renders
SVG, `plt.savefig` offers a PNG download; GET-only network; no `input()`;
the runtime calls `main()` after the script — don't call it yourself.
Quantum-arm numbers vary run-to-run at small step counts (Aer's sampling RNG
is unseeded); that is expected, not a bug.

## Testing status

`tests/test_diagnostics.py`: FFT autocorr vs direct computation, ESS sanity (iid ≈ n, AR(1) shrinks, constant = n), sampler-χ vs `exact_susceptibility` on a small instance, barrier raised to 20 (n=16 computes, n=21 asserts), Diagnostics ESS/stderr sanity. Broader validation strategy: compare sampler moments against `exact_moments`/`exact_cascade` on small `n` (enumeration ground truth).

## Dashboard (`dashboard/`, qollab runtime)

Consolidated advisor-facing front end (one-pager: `docs/ideas/qemcmc-dashboard.md`), replacing the `webapp/` + `qollab_app/` mirrors, which are kept as reference. Two economy tabs (finance/traffic) reusing the shared measurement protocol; numeric parameter inputs mirror the experiment CLIs (defaults = CLI defaults) with regime tooltips from this file.

- Compute split: `py/api.py` (vendored package modules + bridge, plain lists/dicts across the `.toJs()` boundary) does every analytical step; the quantum arm runs in JS (`ui/engine.js`) — the same Trotter circuit via the qiskit JS API, 1 shot per step from qollab's injected `backend` (WASM Aer). `py/` copies must be re-diffed against `src/` after core changes (see `dashboard/README.md`).
- CLI parity is pinned: race Metropolis uses seed offset 0, sequential dose chains use the CLI's `chain_calls` counter (1, 2, …) as seed offset, dose 1 reuses the race χ, and `m(S)` is scored on the ORIGINAL field with the accumulated set (not the per-dose edited field — getting this wrong double-doses). Validated: race relerr/Spearman and metro-seq doses match `experiments/financial_contagion.py` exactly.
- Regret ground truth: `optimal_m` asserts C(n,K) ≤ 60k subsets; UI caps budget at 4.
