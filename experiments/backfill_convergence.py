"""Backfill convergence curves into already-saved scenario JSONs.

Runs made with a scenarios_common.py that predates convergence_curve() lack
the "convergence" block. This recomputes it from the traces those runs DID
save and rewrites the JSON in place. Idempotent; safe to run any time.

Run:  cd experiments && uv run python backfill_convergence.py
      uv run python backfill_convergence.py --only s4_rush_hour
"""

import argparse
import json

from scenarios_common import OUT_DIR, convergence_curve

SCENARIOS = ["s1_conglomerate_core", "s2_hidden_amplifier", "s3_rival_alliances",
             "s4_rush_hour", "s5_city_tipping_point", "s6_metro_at_scale"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", default=SCENARIOS)
    args = ap.parse_args()

    for s in args.only:
        path = OUT_DIR / f"{s}.json"
        if not path.exists():
            print(f"{s:>24}: no JSON (skipped)")
            continue
        story = json.loads(path.read_text())
        if "convergence" in story:
            print(f"{s:>24}: already has convergence curve")
            continue
        curve = convergence_curve(story)
        if curve is None:
            print(f"{s:>24}: no exact truth -> no curve (expected for s6)")
            continue
        story["convergence"] = curve
        path.write_text(json.dumps(story, indent=1))
        for arm in ("metro", "quantum"):
            pts = curve["curves"][arm]
            line = "  ".join(f"{p['steps']}:{p['chi_relerr']:.3f}/{p['mu_spearman']:+.3f}"
                             for p in pts)
            print(f"{s:>24} {arm:>7}: {line}")
        print(f"{s:>24}: backfilled -> {path.name}")


if __name__ == "__main__":
    main()