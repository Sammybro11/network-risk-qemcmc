# QeMCMC showcase: static webapp

Browser-only companion to the `risk_qemcmc` Python package. The pitch is the
general model: any system whose risk is dominated by pairwise correlated
failure is the same Ising Hamiltonian, and each module is one recorded
instantiation of it: a network where a quantum proposal (QeMCMC) races classical
Metropolis to learn the intervention susceptibility, scored against exact
enumeration.

Pure JavaScript, no build step, no backend.

## Structure

The page is two views behind a hash route:

- `#/`: **landing**, pitched at the general model rather than at finance: a
  derivation-style essay with the actual equations typeset by KaTeX (the Ising
  Hamiltonian and Boltzmann distribution, why exact enumeration dies at 2^n, the
  susceptibility `chi_ij = beta Cov(z_i, z_j)` that fluctuation-dissipation turns
  into the intervention ranking, the Metropolis acceptance test and where its
  mixing time fails, and the Trotterised proposal Hamiltonian QeMCMC substitutes),
  a per-term mapping table, how a shock enters (the three diagonal encodings:
  field kick, structure change, seed pinning, with an intervention as the same
  edit sign-flipped), and what is *not* claimed (no wall-clock speedup; the
  quantum arm is simulated). Then a 4x2 grid of eight candidate domains (the two
  implemented ones are clickable), and a card per scenario with its
  steps-to-correct-ranking headline. KaTeX comes from a CDN; if that is
  unreachable the page falls back to raw TeX in the text.
- `#/<scenario-id>`: **dashboard** for one scenario, with a scenario switcher
  at the top of the page and an "All scenarios" link in the header. The id is in
  the URL, so a particular scenario is linkable and the back button works.

## Modules

Four scenarios, all backed by recorded 20,000-step x 4-chain runs:

| module | problem | n | intervention |
| :--- | :--- | --: | :--- |
| Tight Conglomerate Core | finance | 12 | bailout |
| Rush-Hour Gridlock | traffic | 9 | road widening |
| Fragile Periphery, Hidden Amplifier | finance | 12 | bailout |
| Rival Alliances | finance | 12 | bailout |

Finance and traffic differ only in vocabulary: a bailout and a widening are the
same stabilising field edit `h_j -> h_j - omega`, so one adapter
(`adapters/scenario.js`) renders both.

## Panels

1. **Network:** node fill is the exact susceptibility (the answer both
   samplers are chasing), node size is structural centrality, `Q` marks the
   quantum arm's top pick, cascade seeds are ringed.
2. **Sampler race:** each chain's running mean energy against the exact
   thermal mean ⟨E⟩, and raw magnetization against the exact ⟨m⟩ where basin
   crossings show as jumps.
3. **Mechanism:** spins flipped per accepted move (single-spin Metropolis
   cannot exceed 1; the Trotterised proposal flips whole regions) and where
   each chain actually spent its time.
4. **Ranking fidelity** (full width, under the mechanism panel): aggregate
   susceptibility mu per node vs exact truth and the structure-only baselines
   (strength, eigenvector, DebtRank).

## Data flow

`data/scenarios/<name>.json` is written by
`experiments/export_webapp_scenarios.py`. Each file carries both the recorded
run (fidelity, downsampled traces, flip/basin histograms, baselines,
intervention tables, convergence ladder) and the instance it ran on (`J`, `h`,
`A`), so one file drives every panel.

The raw scenario payloads in `experiments/results/` are 100+ MB and Git-LFS
tracked, so the exporter instead reads the committed digests in
`qollab_lab/py/scenarios_data.py` and rebuilds the instance from the scenario
spec with the same `scenarios_common.build_instance()` the recorded runs used.
The rebuild is checked against the digest's edge list and tier labels before
anything is written.

Exact ground truth is re-enumerated in the browser at load; it reproduces the
Python values to ~1e-14.

## Running locally

Any static file server works:

```bash
python3 -m http.server -d webapp 8000
# open http://localhost:8000
```

ES modules are used, so opening `index.html` via `file://` does not work.

## Conventions

Spins are ±1 with bit mapping `bit = (1 - z) // 2`, so `z = +1` is qubit state
|0>; the statevector's amplitude index keeps qubit `i` at bit position `i`, so
no endianness fix-ups are needed anywhere in the JS (the Python/Aer path does
need them).

QeMCMC follows Layden et al. (Nature 619, 282, 2023); the contagion model
follows Tomar et al. (arXiv:2609.17415); the congestion model follows Olmos et
al. (arXiv:2605.03879); the DebtRank baseline follows Battiston et al.
(arXiv:1504.01857).

The quantum arm is an exact statevector simulation, so **no wall-clock speedup
is claimed**. The reported advantage is an iteration-budget gap: steps until
the intervention ranking matches the exact answer.
