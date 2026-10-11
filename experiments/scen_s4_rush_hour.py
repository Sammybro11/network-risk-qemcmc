"""Scenario 4 — Rush-Hour Gridlock (traffic, L=3, n=9).

City grid at the congestion tipping point (vuln near 0, high beta): both the
free-flow and gridlocked configurations are nearly degenerate. Metropolis
starting all-free-flowing freezes there; its widening ranking is blind to the
gridlocked basin's covariance. The quantum proposal flips whole congested
regions per step and ranks widening like the exact answer.

Story: rush hour on a small downtown grid; each widening dose is expensive,
which segments does each method relieve first, and how much total congestion
relief (m) does the city actually get?

Run (smoke):  uv run python experiments/scen_s4_rush_hour.py --smoke
Run (full):   uv run python experiments/scen_s4_rush_hour.py
"""

import argparse

from scenarios_common import run_scenario, save_story

SPEC = {
    "name": "s4_rush_hour",
    "title": "Rush-Hour Gridlock",
    "problem": "traffic",
    "L": 3,
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
    save_story(payload, "s4_rush_hour.json")


if __name__ == "__main__":
    main()