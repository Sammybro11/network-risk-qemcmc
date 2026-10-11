"""QeMCMC showcase lab — qollab Python project entry point.

Two parts, one Run-settings form:

  PART 1 (recorded showcase, ~instant) — every plot for every recorded
  scenario (s1 Conglomerate Core, s2 Hidden Amplifier, s3 Rival Alliances,
  s4 Rush Hour), rendered from compact digests of the full experiments:
  network maps, basin histograms, chain traces, flip-size histograms,
  convergence ladders, ranking bars, regret curves, plus a cross-scenario
  time-to-accuracy summary. Each scenario gets its story printed first.

  PART 2 (live run, low cost) — the Rush-Hour Gridlock scenario rebuilt
  and re-run right here: exact ground truth by enumeration, then a
  Metropolis vs QeMCMC race scored against it, then the widening
  intervention study. Same instance as the recorded s4, so the live
  numbers land next to the showcase numbers.

The quantum arm samples 1 shot per step from qollab's pre-created
`backend` global (the simulator chosen in the Select QPU dialog; the
built-in local simulator is recommended). Default live run: 8,000 steps
-- the recorded QeMCMC time-to-accuracy -- about 80 s, with the live
quantum ranking landing correct while classical MH is still lost. The
deep-dive notebook (scenario_notebook project) exposes the same
protocol with every knob tweakable.
"""

import time
import warnings

import matplotlib
import matplotlib.pyplot as plt
import numpy as np

warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=DeprecationWarning)

try:
    backend  # type: ignore[name-defined]  # noqa: B018 -- qollab injects this global; its runtime renders plt.show() as SVG
    ON_QOLLAB = True
except NameError:
    ON_QOLLAB = False
    backend = None  # local run: no qollab backend global
    matplotlib.use("Agg")  # local run: no display, just produce figures

from py.api import (
    build_instance,
    exact_m,
    optimal_m,
    random_m,
    topk,
)
from py.diag import susceptibility
from py.finance import eigenvector_scores, spearman
from py.gallery import load as load_digests
from py.gallery import run_gallery
from py.mcmc import MCMC
from py.proposals import local_proposal
from py.qe_proposal import QeProposal
from py.qubo import exact_mean_spin, exact_moments, exact_susceptibility
from py.traffic import load_scores

METRO_C = "#c44e52"
QUANTUM_C = "#4c72b0"
EXACT_C = "#2e2e2e"
BASE_COLORS = {"load": "#64b5cd", "eigenvector": "#8172b3"}
TIER_COLORS = {"hub": "#d1495b", "arterial": "#edae49", "local": "#66a182"}

# Scenario 4 (Rush-Hour Gridlock) -- identical to the recorded showcase run,
# so live numbers can be compared against it side by side.
SCENARIO = {"problem": "traffic", "L": 3, "seed": 42, "lam": 2.0, "vuln": 0.05,
            "ring": True, "fracs": (0.15, 0.35, 0.5), "theta": 0.5}


def _sample_mu(J, h, beta, propose, steps, chains, burn_in, seed_offset=0):
    """Aggregate susceptibility ranking from `chains` short chains."""
    results = [
        MCMC(J, h, beta=beta, propose=propose,
             rng=np.random.default_rng(seed_offset + s)).sample(
            steps, z0=np.ones(len(h)), burn_in=burn_in)
        for s in range(chains)
    ]
    states = np.concatenate([r.states for r in results])
    return susceptibility(states, beta).mean(axis=0), results


def main(steps: int = 8000, chains: int = 1, burn_in: int = 80, beta: float = 2.5, vuln: float = 0.05, lam: float = 2.0, frustration: float = 0.0, omega: float = 0.5, budget: int = 3, quantum_gamma: float = 0.5, quantum_time: float = 8.0, live_quantum: bool = True, seed: int = 42):
    """Showcase: all recorded scenarios first (PART 1), then the same
    Rush-Hour scenario re-run live at low cost (PART 2).

    PART 2 knobs (the form): beta / vuln / lam / frustration move the
    instance around its tipping point; steps / chains / burn_in set the
    sampling budget; quantum_gamma / quantum_time shape the Trotterised
    proposal; live_quantum=False gives a classical-only fast pass.
    Defaults: ~1 s of Metropolis + roughly 80 s of simulated Trotter
    circuits (~10 ms/step on the built-in simulator) -- 8,000 steps is
    the recorded QeMCMC time-to-accuracy for this instance, so the live
    quantum ranking lands correct while classical MH is still lost.
    """
    t_start = time.perf_counter()
    print("=" * 72)
    print("PART 1 -- the recorded showcase: 4 scenarios, every plot, from the")
    print("compact digests of the full experiment runs (renders instantly).")
    print("=" * 72)
    run_gallery()

    print()
    print("=" * 72)
    print("PART 2 -- LIVE RUN: Rush-Hour Gridlock rebuilt and raced right here")
    print("(same instance as recorded s4; 8k steps = the recorded QeMCMC")
    print("time-to-accuracy, ~80 s total -- watch the quantum ranking land")
    print("while classical MH is still lost).")
    print("=" * 72)
    _live_run(steps, chains, burn_in, beta, vuln, lam, frustration, omega,
              budget, quantum_gamma, quantum_time, live_quantum, seed)

    print(f"\ntotal wall clock: {time.perf_counter() - t_start:.1f} s. "
          "Figures render as SVG above; PNGs are downloadable from the console output.")


def _live_run(steps, chains, burn_in, beta, vuln, lam, frustration, omega,
              budget, q_gamma, q_time, live_quantum, seed):
    spec = {**SCENARIO, "lam": lam, "vuln": vuln, "seed": seed}
    J, h, A, tiers = build_instance("traffic", spec["L"], spec["seed"],
                                    spec["lam"], spec["vuln"], spec["ring"])
    n = len(h)

    # optional frustration: sign-flip the strongest hub couplings
    fr_edges = []
    k = int(frustration * n)
    if k > 0:
        triu = np.triu_indices(n, 1)
        mask = tiers[triu[0]] == "hub"
        vals = J[triu][mask]
        idx = np.argsort(vals)[:k]
        rows, cols = triu[0][mask][idx], triu[1][mask][idx]
        for i, j in zip(rows, cols):
            J[i, j] = J[j, i] = -J[i, j]
            fr_edges.append((int(i), int(j)))
        print(f"   frustration on: flipped {len(fr_edges)} strongest hub couplings {fr_edges}")

    # ------------------------------------------------------------ stage 1
    print(f"\n[1/3] build the {spec['L']}x{spec['L']} city grid + exact Boltzmann truth (2^{n} states)")
    t0 = time.perf_counter()
    chi_exact = exact_susceptibility(J, h, beta)
    mu_exact = chi_exact.mean(axis=0)
    e_exact, _ = exact_moments(J, h, beta)
    m_exact = float(exact_mean_spin(J, h, beta).mean())
    print(f"      exact: <E>={e_exact:+.3f}, mean health m={m_exact:+.3f} "
          f"({time.perf_counter() - t0:.2f} s by enumeration)")
    hub = next(i for i, t in enumerate(tiers) if t == "hub")
    print(f"      cascade seed: intersection {hub} (the hub)")

    # ------------------------------------------------------------ stage 2
    print(f"\n[2/3] race: {steps} steps x {chains} chain, classical MH then live quantum")
    qe_kwargs = {"gamma": (min(q_gamma, 0.9 * q_gamma), q_gamma),
                 "time": (max(1.0, 0.5 * q_time), q_time)}
    if ON_QOLLAB:
        qe_kwargs["simulator"] = backend  # type: ignore[name-defined] # qollab's pre-created backend global
    arms = {}
    plans: list[tuple] = [("metro", local_proposal, 0)]
    if live_quantum:
        plans.append(("quantum", QeProposal(J, h, **qe_kwargs), 100))
    else:
        print("      live_quantum=False -> quantum arm stubbed with the classical "
              "proposal (fast pass only)")
        plans.append(("quantum", local_proposal, 100))
    for name, propose, seed0 in plans:
        t0 = time.perf_counter()
        mu, results = _sample_mu(J, h, beta, propose, steps, chains, burn_in, seed0)
        dt = time.perf_counter() - t0
        chi = susceptibility(np.concatenate([r.states for r in results]), beta)
        arms[name] = {
            "mu": mu, "results": results,
            "relerr": float(np.linalg.norm(chi - chi_exact) / np.linalg.norm(chi_exact)),
            "spearman": float(spearman(mu, mu_exact)),
            "accept": float(np.mean([r.acceptance_rate for r in results])),
            "wall": dt,
        }
        print(f"      {name:>7}: chi relerr {arms[name]['relerr']:.3f}, "
              f"mu spearman {arms[name]['spearman']:+.3f}, "
              f"accept {arms[name]['accept']:.2f}, {dt:.1f} s "
              f"({1000.0 * dt / max(steps, 1):.1f} ms/step)")

    # ------------------------------------------------------------ stage 3
    print(f"\n[3/3] widening study: omega={omega}, budget={budget} "
          "(who to widen first, and what picking wrong costs)")
    strategies = {
        "exact": mu_exact,
        "metro": arms["metro"]["mu"],
        "quantum": arms["quantum"]["mu"],
        "load": load_scores(A),
        "eigenvector": eigenvector_scores(A),
    }
    table = {name: {str(k): {"m": exact_m(J, h, beta, omega, topk(s, k)),
                             "set": topk(s, k)}
                    for k in range(1, budget + 1)}
             for name, s in strategies.items()}
    opt = optimal_m(J, h, beta, omega, budget)
    rand = random_m(J, h, beta, omega, budget)
    print(f"      {'ranking':>11}: " + "  ".join(f"K={k}: m / regret" for k in range(1, budget + 1)))
    for name in ("exact", "metro", "quantum", "load", "eigenvector"):
        cells = []
        for k in range(1, budget + 1):
            m = table[name][str(k)]["m"]
            reg = max(0.0, opt[str(k)] - m)
            cells.append(f"{m:+.3f}/{reg:.3f}")
        print(f"      {name:>11}: " + "  ".join(f"{c:>12}" for c in cells))
    print(f"      {'optimum':>11}: " + "  ".join(f"{opt[str(k)]:>12.3f}" for k in range(1, budget + 1)))
    print(f"      {'random':>11}: " + "  ".join(f"{rand[str(k)]:>12.3f}" for k in range(1, budget + 1)))

    # ------------------------------------------------------------ figures
    print("\nfigures (live run):")
    _fig_instance(J, h, A, tiers, mu_exact, beta, spec["L"], vuln, fr_edges)
    _fig_race(arms, mu_exact, steps, chains)
    _fig_intervention(table, opt, rand, budget)

    _compare_with_recorded(arms)


def _compare_with_recorded(arms):
    """Side-by-side: this live run vs the recorded s4 showcase numbers."""
    try:
        from py.gallery import fmt_steps, steps_to_good
        rec = load_digests()["s4_rush_hour"]
        fid = rec.get("fidelity", {})
        conv = rec.get("convergence") or {}
        q_good = m_good = None
        if conv:
            q_good = steps_to_good(conv["curves"]["quantum"])
            m_good = steps_to_good(conv["curves"]["metro"])
        print("\nlive vs recorded (same Rush-Hour instance; recorded arm ran "
              f"{rec['spec']['steps']:,} steps x {rec['spec']['chains']} chains "
              "on a remote simulator):")
        print(f"      {'arm':>7} {'':>6} {'chi relerr':>10} {'mu spearman':>12}")
        for name in ("metro", "quantum"):
            live = arms.get(name, {})
            r = fid.get(name, {})
            print(f"      {name:>7} {'live':>6} {live.get('relerr', float('nan')):>10.3f} "
                  f"{live.get('spearman', float('nan')):>12.3f}")
            print(f"      {'':>7} {'rec':>6} {r.get('chi_relerr', float('nan')):>10.3f} "
                  f"{r.get('mu_spearman', float('nan')):>12.3f}")
        if q_good or m_good:
            print(f"\nnote: recorded time-to-accuracy ladder: QeMCMC "
                  f"{fmt_steps(q_good)} steps, classical MH {fmt_steps(m_good)} "
                  "steps to a correct ranking. Below that budget the live arms "
                  "are mid-equilibration (quantum leads) -- set `steps` to "
                  f"{fmt_steps(q_good)} on the form to see the quantum ranking "
                  "land correct live.")
    except Exception as exc:  # noqa: BLE001 # digests are bundled, so this is belt-and-braces
        print(f"\n(skip recorded comparison: {exc})")


# ------------------------------------------------------------- live figures

def _show(fig):
    fig.tight_layout()
    plt.show()
    plt.close(fig)


def _fig_instance(J, h, A, tiers, mu_exact, beta, L, vuln, fr_edges):
    pos = np.array([[(i % L) / (L - 1) if L > 1 else 0.5,
                     1.0 - (i // L) / (L - 1) if L > 1 else 0.5] for i in range(len(h))])
    span = max(mu_exact.max() - mu_exact.min(), 1e-9)
    size = 140 + 1600 * (mu_exact - mu_exact.min()) / span
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10, 4))
    Aa = np.asarray(A, float)
    iu = np.triu_indices(len(h), 1)
    for i, j in zip(*iu):
        if abs(Aa[i, j]) > 1e-9:
            ax1.plot([pos[i, 0], pos[j, 0]], [pos[i, 1], pos[j, 1]],
                     color="#b8c2cc", lw=1, zorder=1)
    for i in range(len(h)):
        ax1.scatter(*pos[i], s=size[i], zorder=3, edgecolor="k", linewidth=0.8,
                    color=TIER_COLORS.get(tiers[i], "#999"))
        ax1.annotate(str(i), pos[i], ha="center", va="center",
                     color="white", fontsize=7, zorder=4, fontweight="bold")
    pad = 0.16  # keep big edge nodes from clipping
    ax1.set_xlim(pos[:, 0].min() - pad, pos[:, 0].max() + pad)
    ax1.set_ylim(pos[:, 1].min() - pad, pos[:, 1].max() + pad)
    ax1.set_title("grid map (size = exact susceptibility)", fontsize=10)
    ax1.set_axis_off()

    im = ax2.imshow(np.asarray(J, float), cmap="RdBu_r")
    ax2.set_title(r"couplings $J_{ij}$ (flipped rows = frustration)", fontsize=10)
    fig.colorbar(im, ax=ax2, fraction=0.046)
    for i, j in fr_edges:
        ax2.add_patch(plt.Rectangle((j - 0.5, i - 0.5), 1, 1, fill=False,  # type: ignore[attr-defined] # Rectangle is re-exported by pyplot at runtime
                                    edgecolor="k", lw=1.4))
    fig.suptitle(f"LIVE Rush-Hour Gridlock ({L}x{L}), beta={beta}, vuln={vuln}",
                 fontsize=11)
    _show(fig)


def _fig_race(arms, mu_exact, steps, chains):
    order = np.argsort(-mu_exact)
    n = len(mu_exact)
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4))
    width = 0.8 / 3
    centers = np.arange(n)
    for i, (name, color) in enumerate((("metro", METRO_C), ("quantum", QUANTUM_C))):
        if name not in arms:
            continue
        mu = np.asarray(arms[name]["mu"], float)[order]
        mu = mu / max(np.abs(mu).max(), 1e-9)
        ax1.bar(centers + (i - 0.5) * width, mu, width, label=name, color=color)
    ex = np.asarray(mu_exact, float)[order]
    ax1.bar(centers + (1 - 0.5) * width, ex / max(np.abs(ex).max(), 1e-9), width,
            label="exact", color=EXACT_C, alpha=0.35)
    ax1.set_xticks(centers)
    ax1.set_xticklabels([str(i) for i in order])
    ax1.set_ylabel(r"$\mu_j$ (normalised)")
    ax1.set_title("widening ranking vs exact", fontsize=10)
    ax1.legend(fontsize=8, frameon=False)

    for name, color in (("metro", METRO_C), ("quantum", QUANTUM_C)):
        if name not in arms:
            continue
        e = np.mean([r.energies for r in arms[name]["results"]], axis=0)
        ax2.plot(np.cumsum(e) / np.arange(1, len(e) + 1), color=color, lw=1.3, label=name)
    ax2.set_xlabel("chain step")
    ax2.set_ylabel("cumulative mean energy")
    ax2.set_title(f"equilibration ({steps} steps x {chains} chain, "
                  "both start all-free-flowing)", fontsize=10)
    ax2.legend(fontsize=8, frameon=False)
    fig.suptitle("LIVE race: classical MH vs QeMCMC", fontsize=11)
    _show(fig)


def _fig_intervention(table, opt, rand, budget):
    ks = [str(k) for k in range(1, budget + 1)]
    fig, ax = plt.subplots(figsize=(8, 4))
    names = ["exact", "metro", "quantum", "load", "eigenvector"]
    width = 0.8 / (len(names) + 1)
    x = np.arange(budget)
    for i, name in enumerate(names):
        vals = [table[name][k]["m"] for k in ks]
        ax.bar(x + (i - (len(names) - 1) / 2) * width, vals, width, label=name,
               color=(EXACT_C if name == "exact" else
                      METRO_C if name == "metro" else
                      QUANTUM_C if name == "quantum" else
                      BASE_COLORS.get(name, "#888")))
    ax.bar(x + (len(names) - 0.5) * width, [opt[k] for k in ks], width,
           label="optimum", color="#2e7d32")
    ax.plot(x, [rand[k] for k in ks], ":", color="#3A4B59", marker="x",
            label="random", lw=1.4)
    ax.set_xticks(x)
    ax.set_xticklabels([f"K={k}" for k in ks])
    ax.set_ylabel("exact mean health m(S) after widening")
    ax.set_title("LIVE widening study: m(S) per strategy and budget (higher = better)")
    ax.legend(fontsize=7, frameon=False, ncol=3)
    _show(fig)
