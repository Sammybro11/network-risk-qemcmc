"""Export compact scenario digests for the qollab lab from experiments/results/.

The full scenario payloads are ~100 MB each (every per-step state of every
chain). The qollab lab runs in the browser (Pyodide), so it can only carry a
distilled version. This script reads each saved story and writes ONE generated
module, qollab_lab/py/scenarios_data.py, containing a zlib+base64 blob with,
per scenario:

  - spec/tiers/cascade/meta and precomputed network positions
  - exact ground truth (energy, m, chi) + sampler fidelity metrics
  - per arm: mu, chi, ESS/step, acceptance, ms/step, wall clock
  - downsampled per-chain energy + magnetization traces, flip-size histogram,
    basin-occupancy histogram, longest stall (enough for every gallery figure,
    a tiny fraction of the bytes)
  - baselines + full intervention tables (static / sequential / random / optimal)
  - the time-to-accuracy convergence ladder

Nothing here re-samples; it is a pure recompression of the recorded runs.

Run:  uv run python experiments/export_scenario_digests.py
Out:  qollab_lab/py/scenarios_data.py  (imported by qollab_lab/py/gallery.py)
"""

import base64
import json
import zlib
from pathlib import Path

import numpy as np

RESULTS = Path(__file__).resolve().parent / "results"
OUT = Path(__file__).resolve().parents[1] / "qollab_lab" / "py" / "scenarios_data.py"

SCENARIOS = [
    "s1_conglomerate_core",
    "s2_hidden_amplifier",
    "s3_rival_alliances",
    "s4_rush_hour",
]

SPEC_KEYS = ("name", "title", "problem", "n", "L", "seed", "lam", "vuln",
             "beta", "omega", "theta", "budget", "frustration", "steps",
             "chains", "burn_in", "ring", "fracs")

MAX_TRACE_PTS = 320   # per chain, energy + magnetization
CHI_ND = 5            # decimals for chi matrices
GEN_ND = 4            # decimals for everything else


def rnd(x, nd=GEN_ND):
    if x is None:
        return None
    return round(float(x), nd)


def rlist(xs, nd=GEN_ND):
    return [rnd(x, nd) for x in xs]


def rmat(m, nd=GEN_ND):
    return [rlist(row, nd) for row in m]


def downsample(xs, max_pts=MAX_TRACE_PTS):
    xs = list(xs)
    step = max(1, len(xs) // max_pts)
    out = xs[::step]
    if out[-1] != xs[-1]:
        out.append(xs[-1])
    return out


def positions(payload):
    """Node coordinates for the network map (traffic: grid; finance: spring)."""
    problem = payload["spec"]["problem"]
    A = np.asarray(payload["instance"]["A"], float)
    if problem == "traffic":
        L = payload["spec"]["L"]
        return [[(i % L) / (L - 1) if L > 1 else 0.5,
                 1.0 - (i // L) / (L - 1) if L > 1 else 0.5] for i in range(L * L)]
    import networkx as nx
    G = nx.from_numpy_array(np.abs(A))
    pos = nx.spring_layout(G, seed=7, weight="weight")
    # normalise to the unit square
    xs = np.array([p[0] for p in pos.values()])
    ys = np.array([p[1] for p in pos.values()])
    xr = float(xs.max() - xs.min()) or 1e-9
    yr = float(ys.max() - ys.min()) or 1e-9
    return [[rnd((p[0] - xs.min()) / xr, 3),
             rnd((p[1] - ys.min()) / yr, 3)]
            for p in pos.values()]


def flip_hist(states_list):
    """Histogram of accepted-move flip sizes across all chains."""
    n = None
    h = None
    for states in states_list:
        s = np.asarray(states)
        if n is None:
            n = s.shape[1]
            h = np.zeros(n + 1, dtype=np.int64)
        if len(s) > 1:
            d = (s[1:] != s[:-1]).sum(axis=1)
            h += np.bincount(d, minlength=n + 1)
    return h.tolist()


def mag_hist(states_list, n):
    """Basin occupancy: histogram of chain magnetization (fraction of spins up)."""
    mags = np.concatenate([np.asarray(s, float).mean(axis=1) for s in states_list])
    counts, _ = np.histogram(mags, bins=n + 1, range=(-1.0 - 0.5 / n, 1.0 + 0.5 / n))
    return [int(c) for c in counts]


def max_stall(accepted_list):
    """Longest run of consecutive rejected proposals (the freezing metric)."""
    best = 0
    for acc in accepted_list:
        cur = 0
        for a in acc:
            cur = cur + 1 if not a else 0
            best = max(best, cur)
    return int(best)


def _edges(A, thresh=1e-9):
    """Sparse edge list [(i, j, |A_ij|)] -- the network map needs only this."""
    A = np.asarray(A, float)
    iu = np.triu_indices(len(A), 1)
    keep = np.abs(A[iu]) > thresh
    return [[int(i), int(j), rnd(abs(A[i, j]), 4)]
            for i, j in zip(iu[0][keep], iu[1][keep])]


def arm_digest(arm, n):
    traces = arm["traces"]
    states_list = [t["states"] for t in traces]
    return {
        "mu": rlist(arm["mu"]),
        "chi": rmat(arm["chi"], CHI_ND),
        "ess_per_step": rnd(arm["ess_per_step"], 5),
        "acceptance": rnd(arm["acceptance"], 4),
        "ms_per_step": rnd(arm["ms_per_step"], 4),
        "wall_clock_s": rnd(arm["wall_clock_s"], 1),
        "energy_traces": [rlist(downsample(t["energies"]), 3) for t in traces],
        "mag_traces": [rlist(downsample(np.asarray(t["states"], float).mean(axis=1)), 3)
                       for t in traces],
        "flip_hist": flip_hist(states_list),
        "mag_hist": mag_hist(states_list, n),
        "max_stall": max_stall([t["accepted"] for t in traces]),
    }


def table_round(table):
    out = {}
    for name, row in table.items():
        out[name] = {}
        for k, cell in row.items():
            if isinstance(cell, dict):
                out[name][k] = {"set": cell.get("set", []),
                                "m": rnd(cell.get("m")),
                                "regret": rnd(cell.get("regret"), 5)}
            elif isinstance(cell, (int, float)) or cell is None:
                out[name][k] = {"set": [], "m": rnd(cell), "regret": None}
            else:  # list: the set itself (m not recorded)
                out[name][k] = {"set": [int(i) for i in cell], "m": None, "regret": None}
    return out


def digest(payload):
    spec = {k: payload["spec"].get(k) for k in SPEC_KEYS if k in payload["spec"]}
    exact = payload.get("exact")
    n = len(payload["instance"]["h"])
    conv = payload.get("convergence")
    return {
        "spec": spec,
        "meta": payload.get("meta", {"frustration_edges": []}),
        "positions": positions(payload),
        "tiers": payload["tiers"],
        "edges": _edges(payload["instance"]["A"]),
        "cascade": {"seeds": payload["cascade"]["seeds"],
                    "n_failed": payload["cascade"]["n_failed"]},
        "exact": None if exact is None else {
            "energy": rnd(exact["energy"], 4),
            "energy_std": rnd(exact["energy_std"], 4),
            "m": rnd(exact["m"], 4),
            "mean_spin": rlist(exact["mean_spin"], 4),
            "chi": rmat(exact["chi"], CHI_ND),
        },
        "fidelity": {a: {k: rnd(v, 4) for k, v in f.items()}
                     for a, f in payload.get("fidelity", {}).items()},
        "arms": {a: arm_digest(arm, n) for a, arm in payload["arms"].items()},
        "baselines": {k: rlist(v) for k, v in payload.get("baselines", {}).items()},
        "intervention": {
            "kind": payload["intervention"]["kind"],
            "omega": payload["intervention"]["omega"],
            "static_table": table_round(payload["intervention"]["static_table"]),
            "sequential_table": table_round(payload["intervention"]["sequential_table"]),
            "random_mean": table_round(payload["intervention"]["random_mean"]),
            "optimal": {k: {"m": rnd(v["m"], 4)} for k, v in payload["intervention"]["optimal"].items()},
        },
        "convergence": None if conv is None else {
            "curves": {a: [{"steps": p["steps"],
                            "chi_relerr": rnd(p["chi_relerr"], 4),
                            "mu_spearman": rnd(p["mu_spearman"], 4)}
                           for p in pts]
                       for a, pts in conv["curves"].items()},
            "note": conv.get("note"),
        },
        "cost_note": (f"recorded run: {payload['spec']['steps']:,} steps x "
                      f"{payload['spec']['chains']} chains; quantum arm wall-clock "
                      f"{payload['arms']['quantum']['wall_clock_s'] / 60:.0f} min on "
                      f"the remote simulator"),
    }


def main():
    stories = {}
    for name in SCENARIOS:
        path = RESULTS / f"{name}.json"
        if not path.exists():
            print(f"{name}: MISSING, skipped")
            continue
        print(f"{name}: loading ({path.stat().st_size / 1e6:.0f} MB)...")
        stories[name] = digest(json.loads(path.read_text()))

    blob = base64.b64encode(zlib.compress(
        json.dumps(stories, separators=(",", ":")).encode(), 9)).decode()

    names = ", ".join(stories)
    header = f'''"""GENERATED by experiments/export_scenario_digests.py -- do not edit.

Compact digests of the recorded showcase scenarios ({names}).
One zlib+base64 JSON blob; gallery.py decompresses it in milliseconds.
Regenerate after re-running any scenario:  uv run python experiments/export_scenario_digests.py
"""

import base64
import json
import zlib


def load():
    """{{scenario_name: payload_dict}} for every recorded showcase scenario."""
    return json.loads(zlib.decompress(base64.b64decode(DIGEST_B64)))


DIGEST_B64 = (
'''
    lines = [f'    "{blob[i:i + 100]}"' for i in range(0, len(blob), 100)]
    OUT.write_text(header + "\n".join(lines) + ")\n")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KiB, "
          f"{len(stories)} scenarios)")


if __name__ == "__main__":
    main()