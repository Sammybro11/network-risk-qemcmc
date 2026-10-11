"""Preflight: verify scenario parameters before committing to long runs.

Runs each scenario's smoke config (metro + quantum, short chains) and checks
the mechanism is present:

  - metro chi collapse: ||chi_metro|| / ||chi_exact|| far below 1, or
    metro Spearman(mu, mu_exact) clearly below the quantum arm's
  - exact mu non-flat: ranking signal exists at all (spread of exact mu)
  - quantum on-Boltzmann: |energy bias| < 4 stderr (when exact truth exists)
  - regret gap: static top-1 regret(metro) - regret(quantum) > 0

Exit code 0 = all scenarios pass (safe to launch long runs in tmux),
1 = at least one scenario needs parameter tuning first.

Run:  uv run python experiments/scen_preflight.py            # all scenarios
      uv run python experiments/scen_preflight.py --only s1  # subset
"""

import argparse
import importlib

import numpy as np
from scenarios_common import (
    run_scenario,
    save_story,
)

SCENARIOS = ["s1_conglomerate_core", "s2_hidden_amplifier", "s3_rival_alliances",
             "s4_rush_hour", "s5_city_tipping_point", "s6_metro_at_scale"]


def load_spec(mod_name):
    mod = importlib.import_module(mod_name)
    return mod.SPEC, mod.SMOKE


def check(payload):
    """Return (ok, list of failure strings) for a smoke-run payload."""
    problems = []
    exact = payload["exact"]
    fidelity = payload["fidelity"]

    if exact is not None:
        chi_exact = np.asarray(exact["chi"], float)
        mu_exact = chi_exact.mean(axis=0)
        spread = float(mu_exact.max() - mu_exact.min())
        if spread < 0.01:
            problems.append(f"exact mu flat (spread={spread:.4f}): no ranking signal")

        f_m = fidelity.get("metro", {})
        f_q = fidelity.get("quantum", {})
        if f_m and f_q:
            if f_m["mu_spearman"] >= f_q["mu_spearman"] - 0.1:
                problems.append(
                    f"metro ranking not clearly worse (metro rho={f_m['mu_spearman']:.3f} "
                    f"vs quantum rho={f_q['mu_spearman']:.3f})")
            if f_m["chi_relerr"] < 0.3:
                problems.append(f"metro chi too good (relerr={f_m['chi_relerr']:.3f}); "
                                "scenario not in the freezing regime")

        # quantum must still be on the exact Boltzmann distribution
        arms = payload["arms"]
        e_exact = exact["energy"]
        e_q = np.concatenate([np.asarray(x, float) for x in arms["quantum"]["energies_sample"]])
        ess_proxy = max(len(e_q) / max(arms["quantum"]["ess_per_step"], 1e-12), 1.0)
        stderr = float(np.std(e_q) / np.sqrt(ess_proxy)) if np.std(e_q) > 0 else 1e9
        bias = float(e_q.mean() - e_exact)
        if abs(bias) > 4 * stderr + 1e-12:
            problems.append(f"quantum energy bias {bias:+.3f} exceeds 4 stderr ({stderr:.3f})")

        # regret gap at K=1 (static)
        table = payload["intervention"]["static_table"]
        if "metro" in table and "quantum" in table:
            r_m = table["metro"]["1"]["regret"]
            r_q = table["quantum"]["1"]["regret"]
            if r_m is not None and r_q is not None and r_m <= r_q:
                problems.append(
                    f"no K=1 regret gap (metro {r_m:.3f} vs quantum {r_q:.3f}); "
                    "tune beta/lam/omega up or vuln")
    else:
        # n > 22: only sanity-check both arms produced distinct rankings
        arms = payload["arms"]
        mu_m = np.asarray(arms["metro"]["mu"], float)
        mu_q = np.asarray(arms["quantum"]["mu"], float)
        if np.linalg.norm(mu_m) < 0.1 * np.linalg.norm(mu_q):
            problems.append(
                f"metro chi collapsed at scale (||mu||={np.linalg.norm(mu_m):.3f} "
                f"vs quantum {np.linalg.norm(mu_q):.3f}) -- this one is expected to PASS "
                "only if the collapse is the point; check manually")

    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", default=SCENARIOS,
                    help="scenario module suffixes to check")
    args = ap.parse_args()

    failures = {}
    for s in args.only:
        mod = f"scen_{s}"
        spec, smoke = load_spec(mod)
        print(f"=== {spec['title']} (smoke: {smoke['steps']} steps x {smoke['chains']} chains) ===")
        payload = run_scenario({**spec, **smoke})
        problems = check(payload)
        failures[s] = problems
        save_story(payload, f"{s}_preflight.json")
        for p in problems:
            print(f"  FAIL: {p}")
        if not problems:
            print("  OK: mechanism present -- safe to launch the long run")

    print("\n==== preflight summary ====")
    for s, ps in failures.items():
        print(f"{s:>24}: {'PASS' if not ps else 'FAIL (' + str(len(ps)) + ')'}")
    if any(failures.values()):
        raise SystemExit(1)
    print("all scenarios pass -- launch the full runs in tmux")


if __name__ == "__main__":
    main()