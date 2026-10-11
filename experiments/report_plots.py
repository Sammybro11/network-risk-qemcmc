"""Generate report figures from the recorded hero run + pasted budget-5 summary.

Data sources:
- webapp/data/run.json: full per-step hero recording (n=12, seed=42, lam=6,
  vuln=0, beta=2.5, omega=2.0, theta=0.15, 4000 steps x 2 chains) for the
  race, chi-heatmap, mu-ranking and energy-trace figures.
- PASTED: summary numbers from the budget-5 recording (same instance) that
  produced the sequential-greedy table, embedded below.

Usage: uv run python experiments/report_plots.py
"""

import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

from risk_qemcmc.problems.finance import financial_instance
from risk_qemcmc.problems.qubo import exact_moments, ising_energy

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "figures"
OUT.mkdir(parents=True, exist_ok=True)

PASTED_RACE = {
    "metro": {"chi_relerr": 0.987, "mu_spear": -0.741, "ess": 0.0427, "accept": 0.072},
    "quantum": {"chi_relerr": 0.168, "mu_spear": 0.881, "ess": 0.0093, "accept": 0.219},
}

PASTED_TABLE = {
    "metro-chi": [0.631, 0.954, 0.980, 0.988, 0.990],
    "quantum-chi": [0.930, 0.937, 0.938, 0.942, 0.946],
    "strength": [0.925, 0.937, 0.938, 0.940, 0.972],
    "eigenvector": [0.855, 0.948, 0.955, 0.958, 0.959],
    "debtrank": [0.855, 0.937, 0.947, 0.980, 0.984],
    "exact-seq": [0.930, 0.967, 0.977, 0.985, 0.988],
    "metro-seq": [0.631, 0.957, 0.983, 0.988, 0.991],
    "quantum-seq": [0.930, 0.967, 0.977, 0.981, 0.983],
    "random-mean": [0.874, 0.945, 0.957, 0.957, 0.965],
    "exact-opt": [0.930, 0.967, 0.983, 0.988, 0.991],
}

EXACT_ENERGY = -17.588

C_METRO = "#d95f4b"
C_QUANTUM = "#2b7bba"
C_EXACT = "#333333"
SEQ_COLORS = {
    "exact-seq": "#555555",
    "metro-seq": C_METRO,
    "quantum-seq": C_QUANTUM,
}
STATIC_COLORS = {
    "metro-chi": "#e8a48f",
    "quantum-chi": "#9bd4ff",
    "strength": "#8c8c8c",
    "eigenvector": "#b3a369",
    "debtrank": "#7fbf7f",
    "random-mean": "#c9a0dc",
}
TIER_COLORS = {"core": "#c0392b", "intermediate": "#e67e22", "periphery": "#27ae60"}

plt.rcParams.update({
    "figure.dpi": 150,
    "font.size": 9,
    "axes.titlesize": 10,
    "axes.titleweight": "bold",
    "axes.spines.top": False,
    "axes.spines.right": False,
})

with open(ROOT / "webapp" / "data" / "run.json") as fh:
    run = json.load(fh)
exact_chi = np.array(run["exact"]["chi"])
exact_mu = np.array(run["exact"]["mu"])
tiers = run["tiers"]
n = run["params"]["n"]


def fig_race():
    metrics = [
        ("chi relerr", "chi_relerr", " susceptibility relative error\n(0 = exact match)", 0.0),
        ("mu Spearman", "mu_spear", "rank correlation with exact\n(1 = perfect ranking)", 1.0),
        ("ESS / step", "ess", "independent samples\nper step", None),
        ("acceptance", "accept", "fraction of accepted\nmoves", None),
    ]
    fig, axes = plt.subplots(1, 4, figsize=(10, 2.9))
    for ax, (title, key, ylabel, ref) in zip(axes, metrics):
        vals = [PASTED_RACE["metro"][key], PASTED_RACE["quantum"][key]]
        bars = ax.bar(["metro", "quantum"], vals, color=[C_METRO, C_QUANTUM], width=0.55)
        ax.set_title(title)
        ax.set_ylabel(ylabel, fontsize=7)
        ax.bar_label(bars, fmt="%.3f", fontsize=8, padding=2)
        if ref is not None:
            ax.axhline(ref, color=C_EXACT, ls="--", lw=1)
            ax.text(0.02, ref, " exact", fontsize=6, va="bottom", color=C_EXACT,
                    transform=ax.get_yaxis_transform())
        ax.margins(y=0.25)
    fig.suptitle("Sampler race on the hero instance (n=12, beta=2.5): quantum learns the "
                 "susceptibility structure, classical MCMC does not", fontsize=10, y=1.08)
    fig.tight_layout()
    fig.savefig(OUT / "fig1_sampler_race.png", bbox_inches="tight")
    plt.close(fig)


def fig_chi_heatmaps():
    q_chi = np.array(run["arms"]["quantum"]["chi"])
    m_chi = np.array(run["arms"]["metro"]["chi"])
    vmax = max(np.abs(exact_chi).max(), np.abs(q_chi).max(), np.abs(m_chi).max())
    q_err = np.abs(q_chi - exact_chi)
    m_err = np.abs(m_chi - exact_chi)
    emax = max(q_err.max(), m_err.max())

    fig, axes = plt.subplots(2, 3, figsize=(10, 7.6),
                             gridspec_kw={"height_ratios": [1.15, 1]})
    for ax, (chi, title) in zip(axes[0], [(exact_chi, "exact $\\chi$ (2$^{12}$ enumeration)"),
                                          (q_chi, "quantum QeMCMC $\\chi$"),
                                          (m_chi, "classical MCMC $\\chi$")]):
        im = ax.imshow(chi, vmin=-vmax, vmax=vmax, cmap="RdBu_r")
        ax.set_title(title)
        ax.set_xticks([0, 5, 11]); ax.set_yticks([0, 5, 11])
    fig.colorbar(im, ax=axes[0], shrink=0.85, label="$\\chi_{ij}$")  # type: ignore[possibly-unbound] # 3-item zip above always binds im

    for ax, (err, title) in zip(axes[1][:2], [(q_err, "|quantum $-$ exact|"),
                                              (m_err, "|metro $-$ exact|")]):
        im = ax.imshow(err, vmin=0, vmax=emax, cmap="viridis")
        ax.set_title(title)
        ax.set_xticks([0, 5, 11]); ax.set_yticks([0, 5, 11])
    axes[1, 2].axis("off")
    axes[1, 2].text(0.05, 0.75,
                    f"relerr  quantum = {q_err.sum() / np.abs(exact_chi).sum():.3f}"
                    f"\nrelerr  metro   = {m_err.sum() / np.abs(exact_chi).sum():.3f}"
                    "\n\nquantum recovers the\nmarginal-utility matrix\nthat drives bailout\npolicy; metro's is noise",
                    fontsize=9, va="top")
    fig.colorbar(im, ax=[axes[1, 1], axes[1, 2]], shrink=0.85, label="abs error")  # type: ignore[possibly-unbound] # 2-item zip above always binds im
    fig.suptitle("Susceptibility matrices $\\chi_{ij} = \\beta\\,$Cov$(z_i, z_j)$ "
                 "(recorded 4000-step hero run)", fontsize=11, y=0.99)
    fig.savefig(OUT / "fig2_chi_heatmaps.png", bbox_inches="tight")
    plt.close(fig)


def fig_mu_ranking():
    q_mu = np.array(run["arms"]["quantum"]["mu"])
    m_mu = np.array(run["arms"]["metro"]["mu"])
    order = np.argsort(-exact_mu)
    x = np.arange(n)
    w = 0.38
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 3.8), sharey=False)
    ax1.bar(x - w / 2, exact_mu[order], w, label="exact", color="#333333")
    ax1.bar(x + w / 2, q_mu[order], w, label="quantum QeMCMC", color=C_QUANTUM)
    ax1.set_ylabel("$\\mu_i$ (bailout marginal utility)")
    ax1.legend(frameon=False, loc="lower left")
    ax1.set_title("exact vs quantum: rankings agree\n(Spearman 0.88)")
    ax2.bar(x, m_mu[order], w, color=C_METRO, label="classical MCMC")
    ax2.axhline(0, color="#999999", lw=0.8)
    ax2.plot(x, exact_mu[order], color="#333333", lw=1.4, ls="--", marker="_",
             label="exact profile (reference)")
    worst_pos = int(np.argmax(m_mu[order]))
    ax2.plot(x[worst_pos], m_mu[order][worst_pos], marker="*", ms=14, color="#7a2015", zorder=5,
             label=f"metro top pick: bank {order[worst_pos]}")
    ax2.set_ylabel("$\\mu_i$ (classical MCMC estimate)")
    ax2.legend(frameon=False, loc="upper right", fontsize=8)
    ax2.set_title("metro on its own scale: bars should decay\nleft to right but do not; top pick is the\n*worst* bank by exact utility (Spearman -0.74)")
    for ax in (ax1, ax2):
        ax.set_xticks(x)
        ax.set_xticklabels([str(i) for i in order])
        for tick, t in zip(ax.get_xticklabels(), [tiers[i] for i in order]):
            tick.set_color(TIER_COLORS[t]); tick.set_fontweight("bold")
        ax.set_xlabel("bank (sorted by exact marginal utility)")
    fig.suptitle("Bailout ranking: per-bank marginal utility (tick color = tier: red core, "
                 "orange intermediate, green periphery)", fontsize=10, y=1.02)
    fig.tight_layout()
    fig.savefig(OUT / "fig3_mu_ranking.png", bbox_inches="tight")
    plt.close(fig)


def fig_energy_traces():
    J, h, _, _ = financial_instance(n=12, seed=42, lam=6.0, vuln=0.0)
    mean_e, _ = exact_moments(J, h, 2.5)
    spins = (1 - 2 * ((np.arange(2 ** 12)[:, None] >> np.arange(12)) & 1)).astype(float)
    floor = min(ising_energy(z, J, h) for z in spins)
    e_q = np.array(run["arms"]["quantum"]["energies"])
    e_m = np.array(run["arms"]["metro"]["energies"])
    fig, ax = plt.subplots(figsize=(10, 3.6))
    for e, label, col in [(e_m, "classical MCMC", C_METRO), (e_q, "quantum QeMCMC", C_QUANTUM)]:
        ax.plot(e, lw=0.3, alpha=0.25, color=col)
        ax.plot(np.convolve(e, np.ones(400) / 400, mode="valid"), lw=2, color=col, label=label)
    ax.axhline(mean_e, color=C_EXACT, ls="--", lw=1.2, label=f"exact $\\langle E \\rangle$ = {mean_e:.2f}")
    ax.axhline(floor, color="#777777", ls=":", lw=1.2, label=f"ground-state floor = {floor:.2f}")
    ax.set_xlabel("MCMC step")
    ax.set_ylabel("energy $E(z)$")
    ax.set_title("Energy traces vs exact thermal average: both chains reach the right band; "
                 "the sampler difference shows up in basin populations ($\\chi$), not mean energy")
    ax.legend(frameon=False, ncol=4, loc="upper right", fontsize=8)
    fig.tight_layout()
    fig.savefig(OUT / "fig4_energy_traces.png", bbox_inches="tight")
    plt.close(fig)
    return mean_e, floor


def fig_bailout_policy():
    ks = np.arange(1, 6)
    opt = np.array(PASTED_TABLE["exact-opt"])
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4))

    for name, m in PASTED_TABLE.items():
        regret = np.maximum(opt - m, 0)
        if name == "exact-opt":
            continue
        if name in SEQ_COLORS:
            ax1.plot(ks, regret, "o-", lw=2.4, ms=5, color=SEQ_COLORS[name], label=name,
                     zorder=3 if name == "quantum-seq" else 2)
        else:
            ax1.plot(ks, regret, "o--", lw=1.1, ms=3.5, alpha=0.55, color=STATIC_COLORS[name],
                     label=name, zorder=1)
    ax1.plot(ks, np.zeros_like(ks), "k:", lw=2, label="exact-opt (exhaustive)", zorder=2.5)
    ax1.set_ylim(-0.002, 0.085)
    ax1.set_xlabel("bailout budget K (number of banks rescued, $\\omega$=2.0 each)")
    ax1.set_ylabel("regret  $m_{\\mathrm{opt}} - m(S)$")
    ax1.set_title("Policy regret vs budget")
    ax1.legend(frameon=False, fontsize=7.5, ncol=5, loc="upper center",
               bbox_to_anchor=(0.5, -0.22))
    ax1.text(1.02, 0.080, "metro-chi / metro-seq K=1 regret = 0.299 (lines clipped)",
             fontsize=7, color=C_METRO)
    ax1.annotate("quantum-seq: sampled-$\\chi$\nmatches exact greedy",
                 xy=(2, 0.0), xytext=(0.5, 0.048), fontsize=8, color=C_QUANTUM,
                 bbox={"fc": "white", "ec": "none", "alpha": 0.85},
                 arrowprops={"arrowstyle": "->", "color": C_QUANTUM})
    ax1.annotate("static quantum ranking\ndegrades at K$\\geq$2",
                 xy=(3, 0.045), xytext=(3.3, 0.063), fontsize=8, color="#2b7bba",
                 bbox={"fc": "white", "ec": "none", "alpha": 0.85},
                 arrowprops={"arrowstyle": "->", "color": "#9bd4ff"})

    for name, m in PASTED_TABLE.items():
        if name in SEQ_COLORS:
            ax2.plot(ks, m, "o-", lw=2.4, ms=5, color=SEQ_COLORS[name], label=name)
        elif name != "exact-opt":
            ax2.plot(ks, m, "o--", lw=1.1, ms=3.5, alpha=0.55, color=STATIC_COLORS[name], label=name)
    ax2.plot(ks, opt, "k:", lw=2, label="exact-opt (exhaustive)")
    ax2.set_xlabel("bailout budget K")
    ax2.set_ylabel("post-rescue health  $m(S)$")
    ax2.set_title("System health after rescue")
    ax2.legend(frameon=False, fontsize=7, ncol=2, loc="lower right")

    fig.suptitle("Bailout policy: sequential re-ranking (bold) vs static rankings (muted) — "
                 "budget-5 recording", fontsize=11)
    fig.tight_layout()
    fig.savefig(OUT / "fig5_bailout_policy.png", bbox_inches="tight")
    plt.close(fig)


if __name__ == "__main__":
    fig_race()
    fig_chi_heatmaps()
    fig_mu_ranking()
    floor = fig_energy_traces()
    fig_bailout_policy()
    print(f"figures written to {OUT} (exact <E> = {floor[0]:.3f}, floor = {floor[1]:.3f})")