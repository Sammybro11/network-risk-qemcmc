"""Scenario 2 — Fragile Periphery, Hidden Amplifier (finance, n=12, vuln>0).

Stressed tiered economy: the periphery is visibly vulnerable, so every
structure-only baseline (strength, DebtRank) and the frozen Metropolis
ranking point at big core banks. The true marginal-rescue bank (per exact
susceptibility mu) is a counterintuitive intermediate/periphery node with
outsized amplification through the dependency matrix A. QeMCMC recovers the
true mu and therefore picks the dose with real bang-per-bailout.

Parameters below are locked by experiments/scen_preflight.py --sweep 2 before
the long run; edit only via the preflight output.

Run (smoke):  uv run python experiments/scen_s2_hidden_amplifier.py --smoke
Run (full):   uv run python experiments/scen_s2_hidden_amplifier.py
"""

import argparse

from scenarios_common import run_scenario, save_story

SPEC = {
    "name": "s2_hidden_amplifier",
    "title": "Fragile Periphery, Hidden Amplifier",
    "problem": "finance",
    "n": 12,
    "seed": 42,
    "lam": 6.0,
    "vuln": 0.2,       # preflight: raise/lower until metro misranks, exact mu non-flat
    "fracs": (0.2, 0.3, 0.5),
    "beta": 2.2,       # stressed but not fully frozen
    "omega": 1.5,      # preflight: tune so wrong dose is visibly wasteful
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
    save_story(payload, "s2_hidden_amplifier.json")


if __name__ == "__main__":
    main()