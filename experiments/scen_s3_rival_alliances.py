"""Scenario 3 — Rival Alliances (finance, n=12, frustrated core).

The strongest core-core couplings are sign-flipped: conglomerates that
previously moved together now compete, so the energy landscape has genuine
barriers between competing coalitions. This is the textbook tunneling regime:
single-spin Metropolis gets trapped in one coalition (its chi is coalition-
local, missing the full covariance structure), while the quantum proposal
samples across coalitions and its bailout ranking tracks the exact optimum.

Story: a conglomerate web where the biggest exposures sit between rivals --
rescuing one side of an alliance can hurt the other; equilibrium
susceptibility is the only guide that sees both coalitions at once.

Run (smoke):  uv run python experiments/scen_s3_rival_alliances.py --smoke
Run (full):   uv run python experiments/scen_s3_rival_alliances.py
"""

import argparse

from scenarios_common import run_scenario, save_story

SPEC = {
    "name": "s3_rival_alliances",
    "title": "Rival Alliances",
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
    "frustration": 0.5,   # sign-flip the 6 strongest core-core couplings
}

FULL = {"steps": 20000, "chains": 4, "burn_in": 2000}
SMOKE = {"steps": 300, "chains": 1, "burn_in": 50}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    args = ap.parse_args()
    cfg = SMOKE if args.smoke else FULL
    payload = run_scenario({**SPEC, **cfg})
    save_story(payload, "s3_rival_alliances.json")


if __name__ == "__main__":
    main()