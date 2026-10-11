"""QeMCMC method-quality lab — qollab Python project entry point.

Console + SVG-figures version of the measurement protocol shared by
experiments/financial_contagion.py and experiments/traffic_congestion.py:

  1. Equilibrium susceptibility chi = beta Cov(z) from MCMC samples,
     classical Metropolis vs the quantum-enhanced (Trotterised) proposal.
  2. Ranking fidelity: mu_j = mean_i chi_ij vs the exact enumeration.
  3. Intervention quality: exact m(S) per budget K for every ranking
     strategy, including the reactive sequential policy arms.

The quantum arm samples 1 shot per step from qollab's pre-created
`backend` global (the simulator chosen in the Select QPU dialog; the
built-in local simulator is recommended).

Tier fractions and the cascade threshold stay at the experiment CLIs'
defaults; pick the economy via `method` ("finance" or "traffic"; for
traffic, `size` is the grid side L).
"""

import warnings

import matplotlib

warnings.filterwarnings("ignore", category=matplotlib.MatplotlibDeprecationWarning)

try:
    backend  # noqa: F821 -- qollab injects this global; its runtime renders plt.show() as SVG
    ON_QOLLAB = True
except NameError:
    ON_QOLLAB = False
    matplotlib.use("Agg")  # local run: no display, just produce figures
import matplotlib.pyplot as plt
import numpy as np

from py.api import full_study

METRO_C = "#F08A73"
QUANTUM_C = "#62B6CF"
EXACT_C = "#A8B0B5"
STATIC_C = "#6A7B89"
SEQ_C = "#C9D6A3"
OPT_C = "#8FBF9F"


def plot_convergence(study):
    fig, ax = plt.subplots(figsize=(7, 4))
    for name, color in (("metro", METRO_C), ("quantum", QUANTUM_C)):
        e = np.asarray(study["arms"][name]["trace"], float)
        ax.plot(np.cumsum(e) / np.arange(1, len(e) + 1), color=color, lw=1.4, label=name)
    ax.axhline(study["exact_energy"], color=EXACT_C, ls="--", lw=1.2, label="exact <E>")
    ax.set_xlabel("chain step")
    ax.set_ylabel("cumulative mean energy")
    ax.legend(loc="best", fontsize=8, frameon=False)
    fig.tight_layout()
    plt.show()
    plt.close(fig)


def plot_ranking(study):
    mu_exact = study["mu_exact"]
    order = np.argsort(-mu_exact)
    fig, ax = plt.subplots(figsize=(7, 4))
    width = 0.8 / 6
    centers = np.arange(study["n"])
    for i, (name, vals, color) in enumerate(
        [
            ("exact", mu_exact, EXACT_C),
            ("metro", study["arms"]["metro"]["mu"], METRO_C),
            ("quantum", study["arms"]["quantum"]["mu"], QUANTUM_C),
        ]
    ):
        ax.bar(centers + (i - 1) * width, vals[order], width, label=name, color=color)
    ax.set_xticks(centers)
    ax.set_xticklabels([f"{i} {study['tiers'][i]}" for i in order], fontsize=7, rotation=45)
    ax.set_ylabel(r"$\mu_j = \mathrm{mean}_i\ \chi_{ij}$")
    ax.legend(fontsize=8, frameon=False)
    fig.tight_layout()
    plt.show()
    plt.close(fig)


def plot_regret(study):
    budget = len(study["optimal"])
    ks = list(range(1, budget + 1))
    fig, ax = plt.subplots(figsize=(7, 4))
    styles = {
        "metro-chi": (METRO_C, "-"),
        "quantum-chi": (QUANTUM_C, "-"),
        "exact-seq": (SEQ_C, "--"),
        "metro-seq": ("#F4B8A8", "--"),
        "quantum-seq": ("#9ED4E4", "--"),
        "random-mean": ("#3A4B59", ":"),
    }
    for name, row in study["table"].items():
        color, ls = styles.get(name, (STATIC_C, "-"))
        ax.plot(ks, [row[str(k)]["m"] for k in ks], color=color, ls=ls, marker="o", ms=3, lw=1.3, label=name)
    ax.plot(ks, [study["optimal"][str(k)] for k in ks], color=OPT_C, ls="--", lw=1.6, label="exact optimum")
    ax.set_xticks(ks)
    ax.set_xlabel("budget K (nodes rescued / widened)")
    ax.set_ylabel("exact mean health m(S)")
    ax.legend(fontsize=7, frameon=False, ncol=2)
    fig.tight_layout()
    plt.show()
    plt.close(fig)


def print_tables(study, omega, budget):
    print(f"n={study['n']} tiers: ", {t: study['tiers'].count(t) for t in set(study['tiers'])})
    print(f"exact: <E>={study['exact_energy']:+.3f}, magnetization m={study['m_exact']:+.3f}")
    print(f"\n{'arm':>8} {'chi relerr':>10} {'mu spear':>9} {'ESS/step':>9} {'accept':>7}")
    for name in ("metro", "quantum"):
        a = study["arms"][name]
        print(f"{name:>8} {a['relerr']:>10.3f} {a['spearman']:>9.3f} {a['ess_per_step']:>9.4f} {a['acceptance']:>7.3f}")

    print(f"\nranking quality at omega={omega}: m(S) under rescue / regret vs exact optimum")
    header = f"{'strategy':>12}" + "".join(f"  K={k:<9d}" for k in range(1, budget + 1))
    print(header)
    for name, row in study["table"].items():
        cells = []
        for k in range(1, budget + 1):
            m = row[str(k)]["m"]
            regret = max(0.0, study["optimal"][str(k)] - m)
            cells.append(f"{m:+.3f}/{regret:.3f}")
        print(f"{name:>12} " + "  ".join(f"{c:<10s}" for c in cells))


def main(method: str = "finance", size: int = 6, lam: float = 6.0, vuln: float = 0.0, beta: float = 2.5, omega: float = 2.0, budget: int = 3, steps: int = 500, chains: int = 2, burn_in: int = 100, seed: int = 42):
    """Run the full method-quality protocol and print tables + figures.

    method: "finance" (size = number of banks) or "traffic" (size = grid side L).
    Recommended regimes: finance size=12 lam=6 vuln=0 beta=2.5 omega=2;
    traffic size=3 lam=2 vuln=0.05 beta=2.5 omega=0.5.
    """
    method = method.strip().lower()
    assert method in ("finance", "traffic"), "method must be 'finance' or 'traffic'"
    ring = True

    simulator = backend if ON_QOLLAB else None  # local: AerSimulator(max_parallel_threads=1)

    print(f"Running {method} study (size={size}, lam={lam}, vuln={vuln}, beta={beta}, omega={omega}, budget={budget})...")
    print("Metropolis chains first, then the live quantum chain (1 shot per step from the selected backend)...")
    study = full_study(
        method, size, seed, lam, vuln, ring, beta, omega, budget, steps, chains, burn_in, backend=simulator
    )

    print_tables(study, omega, budget)
    plot_convergence(study)
    plot_ranking(study)
    plot_regret(study)
    print("\nDone. Figures render as SVG above; PNGs are downloadable from the console output.")
