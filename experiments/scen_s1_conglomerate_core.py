"""Scenario 1 — Tight Conglomerate Core (finance, n=12, degenerate double well).

The pre-validated sure shot (see AGENTS.md regime lessons): vuln=0, beta=2.5
gives a near-degenerate healthy/failed double well. Metropolis freezes in its
start basin so its chi collapses (relerr ~0.99) while the quantum proposal
tunnels between basins (relerr ~0.02) -- the bailout ranking gap follows.

Story: a tightly cross-held conglomerate core in a stressed market; which
banks does each method rescue with a limited bailout budget?

Run (smoke):  uv run python experiments/scen_s1_conglomerate_core.py --smoke
Run (full):   uv run python experiments/scen_s1_conglomerate_core.py
Estimated full runtime: ~50-60 min (quantum side dominates at ~15 ms/step).
"""

import argparse

from scenarios_common import run_scenario, save_story

SPEC = {
    "name": "s1_conglomerate_core",
    "title": "Tight Conglomerate Core",
    "problem": "finance",
    "n": 12,
    "seed": 42,
    "lam": 6.0,
    "vuln": 0.0,
    "fracs": (0.2, 0.3, 0.5),
    "beta": 2.5,
    "omega": 2.0,
    "theta": 0.15,
    "budget": 3,
    "frustration": 0.0,
}

FULL = {"steps": 20000, "chains": 4, "burn_in": 2000}
SMOKE = {"steps": 300, "chains": 1, "burn_in": 50}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    args = ap.parse_args()
    cfg = SMOKE if args.smoke else FULL
    payload = run_scenario({**SPEC, **cfg})
    save_story(payload, "s1_conglomerate_core.json")


if __name__ == "__main__":
    main()