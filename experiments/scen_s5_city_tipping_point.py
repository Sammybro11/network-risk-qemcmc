"""Scenario 5 — City Tipping Point (traffic, L=4, n=16, chunked exact truth).

Same tipping-point story at real grid scale. n=16 is beyond the qubo assert
(n<16) so the exact reference comes from the chunked enumerator in
scenarios_common (memory-safe 2^16 pass, well under the 16 GB budget), and
m(S) evaluation is chunked too -- the optimum-per-budget search stays
exhaustive (C(16,k) subsets).

Story: a mid-size city grid one hot afternoon away from gridlock; capacity
upgrades are budgeted one segment at a time, and the sequential policy shows
which segment to widen next given what was already widened.

Run (smoke):  uv run python experiments/scen_s5_city_tipping_point.py --smoke
Run (full):   uv run python experiments/scen_s5_city_tipping_point.py
"""

import argparse

from scenarios_common import run_scenario, save_story

SPEC = {
    "name": "s5_city_tipping_point",
    "title": "City Tipping Point",
    "problem": "traffic",
    "L": 4,
    "seed": 42,
    "lam": 2.0,
    "vuln": 0.05,
    "fracs": (0.15, 0.35, 0.5),
    "ring": True,
    "beta": 2.5,
    "omega": 0.5,
    "theta": 0.5,
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
    save_story(payload, "s5_city_tipping_point.json")


if __name__ == "__main__":
    main()