# QeMCMC method-quality lab (qollab Python project)

Minimal, pure-Python qollab project: a top-level `main.py` (qollab's
required entry for Python projects), a vendored copy of the package under
`py/`, and **console output with matplotlib SVG figures** — no JS, no HTML,
no chart library. This replaces the abandoned `dashboard/` (JS project)
approach; see `dashboard/CHANGELOG.md` for why.

## What it runs

The same measurement protocol as `experiments/financial_contagion.py` and
`experiments/traffic_congestion.py`, parameterized by qollab's auto-generated
Run-settings form (built from `main()`'s annotated signature):

- `method` — "finance" (size = banks) or "traffic" (size = grid side L)
- `size`, `lam`, `vuln`, `beta`, `omega`, `budget`, `steps`, `chains`, `burn_in`, `seed`

Outputs: sampler diagnostics table (chi relerr / mu Spearman / ESS per step /
acceptance), the full ranking-quality table (m(S) and regret per strategy per
budget, incl. sequential arms), and three SVG figures — cumulative-mean energy
convergence vs exact, mu ranking bars, m(S) vs budget curves.

## The quantum arm on qollab

`QeProposal` now takes an optional `simulator=` argument (core change in
`src/risk_qemcmc/algorithms/qe_proposal.py`). On qollab, `main.py` passes the
runtime-injected `backend` global (the simulator picked in the Select QPU
dialog — use the built-in local simulator); the proposal samples 1 shot per
step through it. Locally (no `backend` global), it falls back to
`AerSimulator(max_parallel_threads=1)` as before. Because qiskit-aer has no
Pyodide wheel, the vendored copy imports it lazily — only when no simulator
is injected — so `requirements.txt` does NOT list qiskit-aer.

## Files

- `main.py` — entry point: Run-settings form, tables, figures.
- `py/` — vendored package modules + `api.py` (study orchestration):
  `qubo/finance/traffic/proposals/mcmc/diag/trotter/qe_proposal`.
  Re-diff against `src/risk_qemcmc/` after core changes:
  ```bash
  for f in qubo finance traffic proposals diag; do
    diff src/risk_qemcmc/problems/$f.py qollab_lab/py/$f.py 2>/dev/null ||
    diff src/risk_qemcmc/algorithms/$f.py qollab_lab/py/$f.py 2>/dev/null ||
    diff src/risk_qemcmc/analysis/$f.py qollab_lab/py/$f.py;
  done
  diff src/risk_qemcmc/compile/trotter.py qollab_lab/py/trotter.py
  ```
  Expected diffs: `mcmc.py` (tqdm stripped), `qe_proposal.py` (relative
  import + injected-simulator support, lazy Aer import).

## Qollab runtime notes (Python projects)

- `main.py` at top level makes it a Python project; the runtime calls
  `main()` after the script finishes — never call it yourself.
- The Run-settings form requires EVERY `main()` parameter annotated with
  plain `int`/`float`/`str`/`bool`, `def main(` starting the line, whole
  signature on one line; otherwise the form silently disappears.
- `backend` is a pre-created global (chosen in the Select QPU dialog);
  never instantiate a simulator on qollab.
- Console shows stdout/stderr; `plt.show()` renders figures as SVG;
  `plt.savefig(name)` offers a PNG download (nothing is written to disk).
- Pyodide 3.14 + qiskit 2.x + NumPy 2.x + matplotlib bundled; GET-only
  network; no `input()`; no run time limit (Stop gives Python 5s).
- Local smoke test: `uv run python -c "import importlib.util; ..."` — see
  the run in `dashboard/CHANGELOG.md`; or simply run the experiment CLIs,
  which share the same protocol.
