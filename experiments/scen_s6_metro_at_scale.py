"""Scenario 6 — Metro at Scale (finance, n=20, no exact truth).

Honest scaling story: n=20 is beyond any enumeration, so there is no exact
reference and no regret number. The claim is instead ground-truth-free and
still damning for classical MCMC: R-hat, ESS/step, autocorrelation time, and
the raw magnitude of the susceptibility matrix (chi collapse). A Metropolis
chain stuck in one basin reports a collapsed chi and disagrees with the
quantum chain about which banks matter -- and the website explains why
tunneling, not more steps, is the fix.

Sized for the remote compute budget: the n=20 Trotter circuit costs far more
per proposal than n=12, so the full run is 8000 steps x 4 chains (~3-4 h).
The chi-collapse signal does not need long chains: a frozen chain's chi
magnitude collapses within a few thousand steps.

Run (smoke):  uv run python experiments/scen_s6_metro_at_scale.py --smoke
Run (full):   uv run python experiments/scen_s6_metro_at_scale.py
"""

import argparse

from scenarios_common import run_scenario, save_story

SPEC = {
    "name": "s6_metro_at_scale",
    "title": "Metro at Scale",
    "problem": "finance",
    "n": 20,
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

FULL = {"steps": 8000, "chains": 4, "burn_in": 800}
SMOKE = {"steps": 300, "chains": 1, "burn_in": 50}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    args = ap.parse_args()
    cfg = SMOKE if args.smoke else FULL
    payload = run_scenario({**SPEC, **cfg})
    save_story(payload, "s6_metro_at_scale.json")


if __name__ == "__main__":
    main()