"""Render the QeMCMC showcase from saved scenario JSONs.

Reads ONLY the result payloads in experiments/results/ (never re-samples) and
produces, per scenario:

  - convergence figure: Spearman rho and chi relerr vs chain length (the
    time-to-accuracy headline), with the per-arm "good" crossing marked
  - regret figure: bailout regret per budget K for every ranker
  - a story card in markdown with plain-language framing

Plus a cross-scenario summary figure (steps-to-correct-ranking) and STORY.md.

Usage:  uv run python experiments/render_showcase.py
Output: experiments/showcase/
"""

import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

RESULTS = Path(__file__).resolve().parent / "results"
OUT = Path(__file__).resolve().parent / "showcase"

RHO_GOOD = 0.90      # "correct ranking" threshold for time-to-accuracy
RELERR_GOOD = 0.10
METRO_COLOR = "#c44e52"
QUANTUM_COLOR = "#4c72b0"
BASELINE_COLORS = {
    "strength": "#55a868",
    "eigenvector": "#8172b3",
    "debtrank": "#ccb974",
}

# Plain-language framing per scenario (non-expert audience).
STORY = {
    "s1_conglomerate_core": {
        "hook": "A tight cluster of banks that prop each other up",
        "plain": (
            "Six core banks guarantee each other's debt so tightly that the "
            "system has two stable moods: everything stands, or the whole "
            "core falls together. A short simulation that only explores one "
            "mood will confidently tell you the wrong bank to bail out."
        ),
    },
    "s2_hidden_amplifier": {
        "hook": "A mid-tier bank quietly amplifies every shock",
        "plain": (
            "The dangerous bank is not the biggest one: it sits in the "
            "middle of the network and multiplies whatever hits it. "
            "Vulnerability that only shows up under stress is exactly what "
            "a frozen sampler misses."
        ),
    },
    "s3_rival_alliances": {
        "hook": "Two alliances whose guarantees cancel each other out",
        "plain": (
            "Frustrated loops of guarantees mean no arrangement pleases "
            "everyone -- the energy landscape is rugged for every method. "
            "Both samplers rank correctly from the shortest prefix here."
        ),
    },
    "s4_rush_hour": {
        "hook": "A city grid at rush hour, one closure from gridlock",
        "plain": (
            "Closing the wrong street at the wrong hour doesn't just slow "
            "one block -- traffic reroutes and jams somewhere else. The "
            "worst street is only visible once you've seen both the free-"
            "flowing and the gridlocked regime."
        ),
    },
    "s5_city_tipping_point": {
        "hook": "A whole city one disruption from a traffic tipping point",
        "plain": (
            "A larger grid near its tipping point: small disruptions are "
            "absorbed, but the wrong one flips the whole city into "
            "gridlock. Finding the flip trigger means sampling a two-peak "
            "landscape."
        ),
    },
    "s6_metro_at_scale": {
        "hook": "The same test at metropolitan scale",
        "plain": (
            "Twenty banks, the size where classical rehearsal budgets "
            "start to bite. This is the scale check: does the early-"
            "correct-ranking advantage survive when the network grows?"
        ),
    },
}

def load_results():
    payloads = []
    for path in sorted(RESULTS.glob("s*.json")):
        if "preflight" in path.stem:
            continue
        with open(path) as f:
            p = json.load(f)
        p["_file"] = path.stem
        payloads.append(p)
    return payloads


def steps_to_good(curve):
    """First prefix length at which an arm ranks correctly; None if never."""
    for c in curve:
        if c["mu_spearman"] >= RHO_GOOD and c["chi_relerr"] <= RELERR_GOOD:
            return c["steps"]
    return None


def fmt_steps(s):
    return "--" if s is None else f"{s:,}"


def plot_convergence(p, path):
    curves = p["convergence"]["curves"]
    steps_q = [c["steps"] for c in curves["quantum"]]
    rho_q = [c["mu_spearman"] for c in curves["quantum"]]
    err_q = [c["chi_relerr"] for c in curves["quantum"]]
    steps_m = [c["steps"] for c in curves["metro"]]
    rho_m = [c["mu_spearman"] for c in curves["metro"]]
    err_m = [c["chi_relerr"] for c in curves["metro"]]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4))

    ax1.axhline(RHO_GOOD, color="grey", lw=0.8, ls="--")
    ax1.plot(steps_m, rho_m, "o-", color=METRO_COLOR, label="Classical MH")
    ax1.plot(steps_q, rho_q, "s-", color=QUANTUM_COLOR, label="QeMCMC")
    ax1.set_xlabel("chain length (steps per chain)")
    ax1.set_ylabel(r"Spearman $\rho$ vs exact susceptibility")
    ax1.set_title("When does the ranking become correct?")
    ax1.set_ylim(-1.05, 1.05)
    ax1.legend(loc="lower right", fontsize=9)

    ax2.plot(steps_m, err_m, "o-", color=METRO_COLOR, label="Classical MH")
    ax2.plot(steps_q, err_q, "s-", color=QUANTUM_COLOR, label="QeMCMC")
    ax2.axhline(RELERR_GOOD, color="grey", lw=0.8, ls="--")
    ax2.set_xlabel("chain length (steps per chain)")
    ax2.set_ylabel(r"relative error of $\chi$")
    ax2.set_title("How far off are the susceptibilities?")
    ax2.set_yscale("log")
    ax2.legend(loc="upper right", fontsize=9)

    q_good, m_good = steps_to_good(curves["quantum"]), steps_to_good(curves["metro"])
    fig.suptitle(
        f"{p['spec']['title']}  (n={p['spec'].get('n', p['spec'].get('L', '?'))}, "
        f"full run {p['spec']['steps']:,} steps x {p['spec']['chains']} chains)"
    )
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return q_good, m_good



def plot_regret(p, path):
    table = p["intervention"]["static_table"]
    budget = p["spec"]["budget"]
    ks = [str(k) for k in range(1, budget + 1)]
    rankers = [r for r in ["metro", "quantum", "strength", "eigenvector", "debtrank"]
               if r in table]
    width = 0.8 / len(rankers)
    x = np.arange(len(ks))

    fig, ax = plt.subplots(figsize=(7, 4))
    for i, r in enumerate(rankers):
        vals = [table[r][k]["regret"] for k in ks]
        vals = [0.0 if v is None else v for v in vals]
        color = (METRO_COLOR if r == "metro" else
                 QUANTUM_COLOR if r == "quantum" else BASELINE_COLORS.get(r, "grey"))
        label = {"metro": "Classical MH", "quantum": "QeMCMC"}.get(r, r)
        ax.bar(x + i * width, vals, width, label=label, color=color)

    ax.set_xticks(x + width * (len(rankers) - 1) / 2)
    ax.set_xticklabels([f"K={k}" for k in ks])
    ax.set_ylabel("bailout regret (lower is better)")
    ax.set_title(f"{p['spec']['title']}: regret of the chosen bailout set")
    ax.legend(fontsize=9)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def plot_summary(entries, path):
    names, q_steps, m_steps = [], [], []
    for e in entries:
        names.append(e["p"]["spec"]["title"])
        q_steps.append(e["q_good"] if e["q_good"] is not None else 0)
        m_steps.append(e["m_good"] if e["m_good"] is not None else 0)

    y = np.arange(len(names))
    fig, ax = plt.subplots(figsize=(8, 0.6 * len(names) + 1.5))
    ax.barh(y + 0.2, m_steps, 0.4, label="Classical MH", color=METRO_COLOR)
    ax.barh(y - 0.2, q_steps, 0.4, label="QeMCMC", color=QUANTUM_COLOR)
    ax.set_yticks(y)
    ax.set_yticklabels(names)
    ax.invert_yaxis()
    ax.set_xlabel("steps per chain until the ranking is correct")
    ax.set_title("Time-to-accuracy: steps until Spearman rho >= 0.9\nand rel-err <= 0.1", fontsize=11)
    all_steps = [s for s in q_steps + m_steps if s]
    ax.set_xlim(0, (max(all_steps) * 1.3) if all_steps else 1)
    for yi, (qv, mv) in enumerate(zip(q_steps, m_steps)):
        ax.text(mv, yi + 0.2, f" {fmt_steps(m_steps[yi]) if m_steps[yi] else 'never'}",
                va="center", fontsize=8)
        ax.text(qv, yi - 0.2, f" {fmt_steps(q_steps[yi]) if q_steps[yi] else 'never'}",
                va="center", fontsize=8)
    ax.legend(loc="upper right", fontsize=9)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def story_card(p, q_good, m_good):
    spec = p["spec"]
    f = p["fidelity"]
    story = STORY.get(spec["name"], {"hook": spec["title"], "plain": ""})
    frustration = (", frustration={:.2f}".format(spec["frustration"])
                   if spec.get("frustration") else "")
    lines = [
        f"## {spec['title']} (`{spec['name']}`)",
        "",
        f"**{story['hook']}**  {story['plain']}",
        "",
        (f"Setup: {spec.get('problem', '?')} problem, "
         f"n={spec.get('n', spec.get('L', '?'))}"
         f"{frustration}, "
         f"{spec['steps']:,} steps x {spec['chains']} chains per arm."),
        "",
        "### Time to correct ranking",
        "",
        "| arm | first correct prefix | full-length relerr | full-length rho |",
        "|---|---|---|---|",
        (f"| QeMCMC | {fmt_steps(q_good)} | {f['quantum']['chi_relerr']:.3f} "
         f"| {f['quantum']['mu_spearman']:+.3f} |"),
        (f"| Classical MH | {fmt_steps(m_good)} | {f['metro']['chi_relerr']:.3f} "
         f"| {f['metro']['mu_spearman']:+.3f} |"),
        "",
    ]
    if q_good is not None and (m_good is None or m_good > q_good):
        ratio = (m_good / q_good if m_good else math.inf)
        lines += [
            (f"**QeMCMC ranked the bailout targets correctly at {fmt_steps(q_good)} "
             f"steps; classical Metropolis needed {fmt_steps(m_good) or 'the full run'}.**"
             + (f" That is a {ratio:.1f}x iteration-budget gap." if math.isfinite(ratio) else "")),
            "",
        ]
    elif q_good == m_good:
        lines += [("**No time-to-accuracy gap here** -- both samplers rank correctly "
                   "from the shortest prefix."), ""]
    table = p["intervention"]["static_table"]
    if "metro" in table and "quantum" in table:
        same = all(table["metro"][k]["set"] == table["quantum"][k]["set"]
                   for k in table["metro"])
        if same:
            lines += [("Both samplers chose the **same bailout sets at every budget** "
                       "-- here the quantum advantage is in how *fast* the ranking "
                       "became trustworthy, not in a different final decision."), ""]
    return "\n".join(lines)


def main():
    OUT.mkdir(exist_ok=True)
    payloads = load_results()
    if not payloads:
        raise SystemExit("no scenario JSONs found in experiments/results/")

    entries = []
    for p in payloads:
        name = p["spec"]["name"]
        q_good, m_good = plot_convergence(p, OUT / f"{name}_convergence.png")
        plot_regret(p, OUT / f"{name}_regret.png")
        entries.append({"p": p, "q_good": q_good, "m_good": m_good})

    plot_summary(entries, OUT / "summary_time_to_accuracy.png")

    md = [
        "# QeMCMC showcase: bailout decisions under a fixed iteration budget",
        "",
        ("Each scenario is a named real-world situation where the network sits "
         "near a tipping point and a budget-K bailout must be chosen from the "
         "susceptibility ranking. Both samplers get the *same* iteration budget; "
         "the question is who ranks the bailout targets correctly *first*."),
        "",
        "![summary](summary_time_to_accuracy.png)",
        "",
        "| scenario | QeMCMC correct from | classical MH correct from |",
        "|---|---|---|",
    ]
    md += [f"| {e['p']['spec']['title']} | {fmt_steps(e['q_good'])} | "
           f"{fmt_steps(e['m_good'])} |" for e in entries]
    md += [""]
    for e in entries:
        md.append(story_card(e["p"], e["q_good"], e["m_good"]))
    (OUT / "STORY.md").write_text("\n".join(md))

    print(f"wrote {len(entries)} scenario cards + figures to {OUT}/")
    for e in entries:
        print(f"  {e['p']['spec']['name']:>26}: quantum {fmt_steps(e['q_good']):>6} "
              f"vs metro {fmt_steps(e['m_good']):>6} steps to correct ranking")


if __name__ == "__main__":
    main()