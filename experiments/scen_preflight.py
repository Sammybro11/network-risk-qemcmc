"""Preflight: verify scenario parameters before committing to long runs.

Runs each scenario's smoke config (metro + quantum, short chains) and checks
the mechanism is present:

  - exact mu non-flat: ranking signal exists at all (spread of exact mu)
  - metro chi collapse: metro Spearman(mu, mu_exact) clearly below the
    quantum arm's, and metro chi relerr large (frozen, not merely noisy)
  - quantum sanity: |energy bias| < 0.5 even on a short chain (a larger
    offset suggests a circuit/normalization problem, not just noise)

The full-length energy-bias (4 stderr) and regret-gap checks are withheld on
smoke runs on purpose: a 300-step chain is unequilibrated, so its mean energy
is biased by construction (it starts in one basin), and per-K regret from 300
samples is noise. Those checks run with --full (full-length chains).

Exit code 0 = all scenarios pass (safe to launch long runs in tmux),
1 = at least one scenario needs parameter tuning first.

Run:  uv run python experiments/scen_preflight.py            # all, smoke checks
      uv run python experiments/scen_preflight.py --only s1  # subset
      uv run python experiments/scen_preflight.py --full     # + bias/regret checks
"""

import argparse
import importlib

import numpy as np
from scenarios_common import run_scenario, save_story

SCENARIOS = ["s1_conglomerate_core", "s2_hidden_amplifier", "s3_rival_alliances",
             "s4_rush_hour", "s5_city_tipping_point", "s6_metro_at_scale"]


def load_spec(mod_name):
    mod = importlib.import_module(mod_name)
    return mod.SPEC, mod.SMOKE, mod.FULL


def check(payload, smoke=True):
    """Return list of failure strings for a run payload.

    smoke=True (300-step chains): the energy-bias and regret-gap checks are
    withheld -- an unequilibrated chain has biased energy BY CONSTRUCTION
    (it starts in one basin), and per-K regret on 300 samples is noise.
    Only mechanism checks run: metro must misrank while quantum ranks well.
    Full-length runs (>= 4000 total steps, matching the convention in
    financial_contagion.py) get every check including energy bias.
    """
    problems = []
    exact = payload["exact"]
    fidelity = payload["fidelity"]

    if exact is None:
        # n too large to enumerate: sanity-check both arms produced rankings
        arms = payload["arms"]
        mu_m = np.asarray(arms["metro"]["mu"], float)
        mu_q = np.asarray(arms["quantum"]["mu"], float)
        if np.linalg.norm(mu_m) < 0.1 * np.linalg.norm(mu_q):
            problems.append(
                f"metro chi collapsed at scale (||mu||={np.linalg.norm(mu_m):.3f} "
                f"vs quantum {np.linalg.norm(mu_q):.3f}) -- expected to PASS "
                "only if the collapse is the point; check manually")
        return problems

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

    arms = payload["arms"]
    e_q = np.concatenate(
        [np.asarray(x, float) for x in arms["quantum"]["energies_sample"]])
    # ESS-corrected stderr: ess_per_step is ESS per chain step, so total ESS
    # is ess_per_step * n_total (the old len/ess_per_step was wrong by ~100x)
    n_total = len(e_q)
    ess = max(arms["quantum"]["ess_per_step"] * n_total, 1.0)
    bias = float(e_q.mean() - exact["energy"])
    if not smoke:
        # equilibrated chain: the honest on-Boltzmann check applies
        stderr = float(np.std(e_q) / np.sqrt(ess)) if np.std(e_q) > 0 else 1e9
        if abs(bias) > 4 * stderr + 1e-12:
            problems.append(
                f"quantum energy bias {bias:+.3f} exceeds 4 stderr ({stderr:.3f})")
    elif abs(bias) > 0.5:
        problems.append(
            f"quantum energy bias {bias:+.3f} far from exact even for a short "
            "chain -- check mixer weight / Trotter dt, or rerun at full length")

    if not smoke:
        # regret gap at K=1 (static): only meaningful with equilibrated arms
        table = payload["intervention"]["static_table"]
        if "metro" in table and "quantum" in table:
            r_m = table["metro"]["1"]["regret"]
            r_q = table["quantum"]["1"]["regret"]
            if r_m is not None and r_q is not None and r_m <= r_q:
                problems.append(
                    f"no K=1 regret gap (metro {r_m:.3f} vs quantum {r_q:.3f}); "
                    "tune beta/lam/omega up or vuln")

    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", default=SCENARIOS,
                    help="scenario module suffixes to check")
    ap.add_argument("--full", action="store_true",
                    help="run full-length chains and apply every check incl. "
                         "energy bias and regret gap (slow)")
    args = ap.parse_args()

    failures = {}
    for s in args.only:
        mod = f"scen_{s}"
        spec, smoke, full = load_spec(mod)
        cfg = full if args.full else smoke
        mode = "FULL-LENGTH" if args.full else "smoke"
        print(f"=== {spec['title']} ({mode}: {cfg['steps']} steps x {cfg['chains']} chains) ===")
        payload = run_scenario({**spec, **cfg})
        problems = check(payload, smoke=not args.full)
        failures[s] = problems
        suffix = "preflight_full" if args.full else "preflight"
        save_story(payload, f"{s}_{suffix}.json")
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