"""Export the recorded showcase scenarios to the static webapp.

The raw payloads in experiments/results/ are 100+ MB each and Git-LFS tracked,
so they are usually not present in a working copy. The compact digests baked
into qollab_lab/py/scenarios_data.py ARE committed, and they carry every
recorded number the dashboard needs (fidelity, traces, flip/basin histograms,
intervention tables, convergence ladder).

What the digests do NOT carry is the instance itself (J, h, A) -- the qollab
gallery never needed it. The browser does: live runs, exact re-enumeration and
the intervention lab all work off (J, h). Instances are deterministic in
(problem, n/L, seed, lam, vuln, fracs, frustration), so this script rebuilds
them with the same scenarios_common.build_instance() the recorded runs used and
cross-checks the rebuild against the digest before writing.

Run:  uv run python experiments/export_webapp_scenarios.py
Out:  webapp/data/scenarios/<name>.json  +  webapp/data/scenarios/index.json
"""

import json
import sys
from pathlib import Path

import numpy as np

from scenarios_common import build_instance

REPO = Path(__file__).resolve().parents[1]
OUT_DIR = REPO / "webapp" / "data" / "scenarios"

# The narrative lives with the qollab gallery; the webapp reuses it verbatim so
# the two front-ends never tell different stories about the same run.
sys.path.insert(0, str(REPO / "qollab_lab"))
from py.gallery_text import CAVEATS, HOW_TO_READ, _STORIES  # noqa: E402
from py.scenarios_data import load as load_digests  # noqa: E402

GEN_ND = 4


def rmat(m, nd=GEN_ND):
    return [[round(float(x), nd) for x in row] for row in m]


def rlist(xs, nd=GEN_ND):
    return [round(float(x), nd) for x in xs]


def check_rebuild(name, digest, A, tiers):
    """Fail loudly if the rebuilt instance is not the recorded one.

    The digest's edge list is the |A| upper triangle rounded to 4 decimals, and
    its tier labels came from the same builder -- both are tight fingerprints.
    """
    rebuilt = {
        (int(i), int(j)): round(abs(float(A[i, j])), 4)
        for i, j in zip(*np.triu_indices(len(A), 1))
        if abs(A[i, j]) > 1e-9
    }
    recorded = {(int(i), int(j)): float(w) for i, j, w in digest["edges"]}
    if rebuilt != recorded:
        only_new = set(rebuilt) - set(recorded)
        only_old = set(recorded) - set(rebuilt)
        drift = [(k, rebuilt[k], recorded[k]) for k in set(rebuilt) & set(recorded)
                 if rebuilt[k] != recorded[k]]
        raise SystemExit(
            f"[{name}] rebuilt instance does not match the digest: "
            f"{len(only_new)} new edges, {len(only_old)} missing, "
            f"{len(drift)} weight mismatches (first: {drift[:3]})"
        )
    if list(tiers) != list(digest["tiers"]):
        raise SystemExit(f"[{name}] tier labels drifted from the digest")


def build_payload(name, digest):
    spec = digest["spec"]
    J, h, A, tiers, meta = build_instance(spec)
    check_rebuild(name, digest, A, tiers)

    hook, verdict = _STORIES.get(name, ("", ""))
    payload = dict(digest)
    payload["instance"] = {"J": rmat(J), "h": rlist(h), "A": rmat(A)}
    payload["meta"] = {**digest.get("meta", {}), **meta}
    payload["narrative"] = {
        "story": hook,
        "verdict": verdict,
        "howToRead": HOW_TO_READ,
        "caveats": CAVEATS,
    }
    return payload


def steps_to_rank(payload, threshold=0.9):
    """Steps until each arm's intervention ranking matches the exact answer.

    This is the headline the landing page shows, because at the full budget
    both arms converge -- the defensible claim is the iteration budget, not
    final accuracy. None means "never, within the recorded run".
    """
    curves = payload.get("convergence", {}).get("curves", {})
    out = {}
    for arm in ("quantum", "metro"):
        hit = next((p for p in curves.get(arm, []) if p["mu_spearman"] >= threshold), None)
        out[arm] = hit["steps"] if hit else None
    return out


def main():
    digests = load_digests()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    index = []

    for name, digest in digests.items():
        payload = build_payload(name, digest)
        path = OUT_DIR / f"{name}.json"
        path.write_text(json.dumps(payload, separators=(",", ":")))
        spec = payload["spec"]
        index.append({
            "id": name,
            "title": spec["title"],
            "problem": spec["problem"],
            "n": len(payload["instance"]["h"]),
            "beta": spec["beta"],
            "steps": spec["steps"],
            "chains": spec["chains"],
            "kind": payload["intervention"]["kind"],
            # card copy + headline, so the landing page needs no payload fetch
            "story": payload["narrative"]["story"],
            "verdict": payload["narrative"]["verdict"],
            "stepsToRank": steps_to_rank(payload),
            "fidelity": payload["fidelity"],
        })
        print(f"  {name:24s} n={index[-1]['n']:2d}  {path.stat().st_size / 1024:6.1f} KB")

    (OUT_DIR / "index.json").write_text(json.dumps(index, indent=1))
    print(f"wrote {len(index)} scenarios + index.json to {OUT_DIR.relative_to(REPO)}")


if __name__ == "__main__":
    main()
