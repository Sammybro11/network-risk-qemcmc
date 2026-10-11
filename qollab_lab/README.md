# QeMCMC showcase lab (qollab Python project)

One Run button, two parts, console output with matplotlib SVG figures — no
JS, no HTML, no chart library. A top-level `main.py` (qollab's required
entry for Python projects), a vendored copy of the package under `py/`,
and the compact scenario digests baked into `py/scenarios_data.py`.
This replaces the abandoned `dashboard/` (JS project) approach; see
`dashboard/CHANGELOG.md` for why.

## Part 1 — recorded scenario gallery (renders instantly)

Every plot for every recorded showcase scenario (s1 Conglomerate Core,
s2 Hidden Amplifier, s3 Rival Alliances, s4 Rush Hour), from ~35 KB digests
of the ~100 MB experiment payloads (regenerate with
`experiments/export_scenario_digests.py`):

- network map (tier colours, node size = exact susceptibility, Q = quantum
  top pick, cascade seeds ringed)
- basin histograms (where each sampler spends its time vs exact m)
- energy + magnetization chain traces (the freezing story)
- accepted-move flip-size histograms (the mechanism: local hops vs
  multi-spin region flips)
- convergence ladders (steps until the ranking is correct)
- mu ranking bars vs structural baselines; regret curves for static AND
  sequential policies
- cross-scenario time-to-accuracy summary

Each scenario prints its story + fidelity/cost table first
(`py/gallery_text.py` holds the narrative; caveats included).

## Part 2 — low-cost live run (~1 min)

Right after the gallery, the s4 Rush-Hour instance is rebuilt and re-run
live: exact truth by 2^9-state enumeration, Metropolis vs QeMCMC race
(1 shot/step through the `backend` global), widening intervention study,
then 3 figures and a live-vs-recorded comparison table against the
recorded s4 numbers. Defaults are `steps=400, chains=1, burn_in=60` and
`live_quantum=True`; the remaining form fields (`beta`, `vuln`, `lam`,
`frustration`, `omega`, `budget`, `quantum_gamma`, `quantum_time`, `seed`)
move the instance and proposal around.

For the fully tweakable, slower-default version of the same protocol see
the separate `scenario_notebook/` qollab project (every knob on the form,
staged prints between stages).

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

- `main.py` — entry point: Run-settings form, gallery, live run, figures.
- `py/` — vendored package modules + `api.py` (study orchestration):
  `qubo/finance/traffic/proposals/mcmc/diag/trotter/qe_proposal`, plus
  `scenarios_data.py` (bundled digests) and `gallery.py` / `gallery_text.py`
  (the Part 1 renderer).
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
- Local smoke test (Aer works locally; it just fails inside some sandboxes
  with an OMP SHM error):
  ```bash
  MPLCONFIGDIR=$PWD/.smoke/mplt .venv/bin/python -c \
    "import matplotlib; matplotlib.use('Agg'); import main; main.main(steps=60, burn_in=10)"
  ```
