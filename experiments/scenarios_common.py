"""Shared "real scenario" protocol: instance -> race -> bailout story -> JSON.

One protocol, six scenario scripts. Each scenario script is a thin parameter
bundle (see scen_*.py); all heavy lifting lives here so the measurement is
identical across scenarios and every figure on the website comes from the
same table format.

Pipeline per scenario (run_scenario):

  1. Instance (finance EGJ or traffic grid) with optional frustration: the
     strongest top-tier couplings are sign-flipped, creating competing
     coalitions (real energy barriers -- the regime where local Metropolis
     freezes and the quantum proposal tunnels).
  2. Exact ground truth. n <= 15 via qubo.exact_*; n == 16..22 via a chunked
     enumerating reference (memory-safe: never materializes all 2^n states at
     once, fits well under 16 GB). n > 22: no exact truth -- ground_truth is
     null and the story is told by ground-truth-free diagnostics (R-hat, ESS,
     autocorrelation, chi collapse).
  3. Race: Metropolis vs QeMCMC on the same seeds; chi, mu, ranking fidelity.
  4. Intervention policies: static top-K per ranking + sequential reactive
     greedy (re-ranked per dose), evaluated against the exact post-intervention
     equilibrium m(S). Static baselines (strength/eigenvector/debtrank/load)
     included for context.
  5. Story payload: per budget K, per arm {set, m, regret} + diagnostics.

Run (smoke):  uv run python experiments/scen_s1_conglomerate_core.py --smoke
Run (full):   uv run python experiments/scen_s1_conglomerate_core.py
"""

import json
import time
from itertools import combinations
from pathlib import Path

import numpy as np

from risk_qemcmc.algorithms.mcmc import MCMC
from risk_qemcmc.algorithms.proposals import local_proposal
from risk_qemcmc.algorithms.qe_proposal import QeProposal
from risk_qemcmc.analysis.diagnostics import Diagnostics, susceptibility
from risk_qemcmc.problems.finance import (
    apply_bailout,
    cascade_closure,
    debtrank_scores,
    eigenvector_scores,
    financial_instance,
    sequential_greedy,
    spearman,
    strength_scores,
)
from risk_qemcmc.problems.qubo import (
    exact_mean_spin,
    exact_moments,
    exact_susceptibility,
)
from risk_qemcmc.problems.traffic import apply_widening, load_scores, traffic_instance

OUT_DIR = Path(__file__).resolve().parent / "results"


# ---------------------------------------------------------------- instance


def build_instance(spec):
    """(J, h, A, tiers, meta) from a scenario spec dict.

    spec keys: problem ("finance"|"traffic"), n or L, seed, lam, vuln, fracs,
    (traffic: ring), frustration (0..1: fraction of strongest same-tier-top
    couplings sign-flipped; 0 = off).
    """
    if spec["problem"] == "finance":
        J, h, A, tiers = financial_instance(
            spec["n"], seed=spec["seed"], lam=spec["lam"], vuln=spec["vuln"],
            fracs=tuple(spec.get("fracs", (0.2, 0.3, 0.5))),
        )
        core = "core"
        n = spec["n"]
    else:
        J, h, A, tiers = traffic_instance(
            spec["L"], seed=spec["seed"], lam=spec["lam"], vuln=spec["vuln"],
            ring=spec.get("ring", True), fracs=tuple(spec.get("fracs", (0.15, 0.35, 0.5))),
        )
        core = "hub"
        n = spec["L"] ** 2

    frustration_edges = []
    k = int(spec.get("frustration", 0.0) * n)
    if k > 0:
        # strongest couplings inside the top tier, sign-flipped: rival
        # alliances that a single-spin walk cannot reconcile
        triu = np.triu_indices(n, 1)
        mask = tiers[triu[0]] == core
        vals = J[triu][mask]
        idx = np.argsort(vals)[:k]  # most ferromagnetic (most negative)
        rows = triu[0][mask][idx]
        cols = triu[1][mask][idx]
        for i, j in zip(rows, cols):
            J[i, j] = J[j, i] = -J[i, j]
            frustration_edges.append([int(i), int(j)])
    return J, h, A, tiers, {"frustration_edges": frustration_edges}


# ---------------------------------------------------- exact ground truth


def _enumerate_chunked(J, h, beta, chunk=4096):
    """Memory-safe exact Boltzmann reference for n <= ~22 (chunked 2^n pass).

    Same math as qubo._enumerate but never materializes all states at once;
    used at n == 16 where the qubo assert blocks. Returns (mean_energy,
    energy_std, mean_spin, chi).
    """
    n = len(h)
    total = 1 << n
    s1 = 0.0
    sE = 0.0
    sE2 = 0.0
    mz = np.zeros(n)
    mzz = np.zeros((n, n))
    for start in range(0, total, chunk):
        codes = np.arange(start, min(start + chunk, total))
        states = ((codes[:, None] >> np.arange(n)) & 1) * 2 - 1
        energies = 0.5 * np.einsum("si,ij,sj->s", states, J, states) + states @ h
        w = np.exp(-beta * (energies - energies.min()))
        w_sum = w.sum()
        s1 += w_sum
        sE += w @ energies
        sE2 += w @ (energies**2)
        wz = w / w_sum
        mz += wz @ states
        mzz += (states * wz[:, None]).T @ states
    mean = sE / s1
    std = float(np.sqrt(max(sE2 / s1 - mean**2, 0.0)))
    mean_spin = mz / s1
    cov = mzz / s1 - np.outer(mean_spin, mean_spin)
    return mean, std, mean_spin, beta * cov


def exact_reference(J, h, beta):
    """dict with exact moments/spin/chi, or None if n too large to enumerate.

    n < 16: qubo.exact_*. 16 <= n <= 22: chunked pass.
    """
    n = len(h)
    if n < 16:
        e, e_std = exact_moments(J, h, beta)
        mean_spin = np.asarray(exact_mean_spin(J, h, beta), float)
        return {
            "energy": e, "energy_std": e_std,
            "mean_spin": mean_spin.tolist(),
            "m": float(mean_spin.mean()),
            "chi": np.asarray(exact_susceptibility(J, h, beta), float).tolist(),
        }
    if n <= 22:
        e, e_std, mean_spin, chi = _enumerate_chunked(J, h, beta)
        return {
            "energy": e, "energy_std": e_std,
            "mean_spin": mean_spin.tolist(),
            "m": float(mean_spin.mean()),
            "chi": chi.tolist(),
        }
    return None


def m_of_factory(J, h, beta, omega, apply_fn):
    """exact post-intervention mean health m(S); None if not computable."""
    n = len(h)
    if n > 22:
        return None
    if n < 16:
        def m_of(S):
            if not S:
                return float(np.asarray(exact_mean_spin(J, h, beta), float).mean())
            return float(np.asarray(
                exact_mean_spin(J, apply_fn(h, S, omega), beta), float).mean())
    else:
        def m_of(S):
            _, _, mean_spin, _ = _enumerate_chunked(J, apply_fn(h, S, omega), beta)
            return float(mean_spin.mean())
    return m_of


# ------------------------------------------------------------------ race


def run_chains(J, h, beta, propose, steps, chains, burn_in, seed_offset=0,
               record=False):
    """Sample `chains` independent chains.

    record=True attaches a per-step "trace" dict to each MCMCResult:
    states (int8), energies, accepted flags, and for the quantum proposal
    the per-step Trotter params (gamma, time, r). Burn-in steps are not in
    the arrays (matching states/energies) but their proposal params are
    included in the trace list.
    """
    results = []
    for seed in range(chains):
        draws: list = []

        if record:
            def propose_rec(z, rng, _inner=propose, _draws=draws):
                prop = _inner(z, rng)
                _draws.append(getattr(_inner, "last_params", None))
                return prop

            use_propose = propose_rec
        else:
            use_propose = propose

        res = MCMC(J, h, beta=beta, propose=use_propose,
                   rng=np.random.default_rng(seed_offset + seed)).sample(
            steps, z0=np.ones(len(h)), burn_in=burn_in)

        if record:
            n_steps = res.n_steps
            res.trace = {
                "states": np.asarray(res.states, dtype=np.int8),
                "energies": np.asarray(res.energies, float),
                "accepted": np.asarray(res.accepted, bool),
                "proposal_params": draws[-n_steps:] if draws else None,
                "z0": np.ones(len(h), dtype=np.int8).tolist(),
                "burn_in": int(burn_in),
                "seed": int(seed_offset + seed),
            }
        results.append(res)
    return results


def race(J, h, beta, steps, chains, burn_in, qe_kwargs=None, record=False):
    """Metropolis vs QeMCMC on identical seeds. Returns arms dict.

    record=True keeps the full per-chain trace dicts (not JSON-ready;
    serialized by the story writer).
    """
    arms = {}
    for name, propose in (
        ("metro", local_proposal),
        ("quantum", QeProposal(J, h, **(qe_kwargs or {}))),
    ):
        t0 = time.perf_counter()
        results = run_chains(J, h, beta, propose, steps, chains, burn_in,
                             record=record)
        elapsed = time.perf_counter() - t0
        states = np.concatenate([r.states for r in results])
        chi = susceptibility(states, beta)
        mu = chi.mean(axis=0)
        diags = [Diagnostics(r) for r in results]
        arms[name] = {
            "chi": chi.tolist(),
            "mu": mu.tolist(),
            "chi_norm": float(np.linalg.norm(chi)),
            "ess_per_step": float(np.mean(
                [d.ess() / r.n_steps for d, r in zip(diags, results)])),
            "acceptance": float(np.mean([r.acceptance_rate for r in results])),
            "wall_clock_s": elapsed,
            "ms_per_step": elapsed / (steps * chains) * 1e3,
            "energies_sample": [r.energies[:: max(1, len(r.energies) // 500)].tolist()
                                for r in results],
        }
        if record:
            arms[name]["traces"] = results  # list of MCMCResult with .trace
    return arms


def ranking_fidelity(arms, chi_exact):
    """Per-arm fidelity metrics vs exact (empty dicts when no truth)."""
    out = {name: {} for name in arms}
    if chi_exact is None:
        return out
    chi_exact = np.asarray(chi_exact, float)
    mu_exact = chi_exact.mean(axis=0)
    for name, arm in arms.items():
        chi = np.asarray(arm["chi"], float)
        mu = np.asarray(arm["mu"], float)
        out[name] = {
            "chi_relerr": float(np.linalg.norm(chi - chi_exact) / np.linalg.norm(chi_exact)),
            "mu_spearman": spearman(mu, mu_exact),
        }
    return out


# -------------------------------------------------------- intervention story


def _story_cell(m_of, S, opt, k):
    if m_of is None:
        return {"set": S, "m": None, "regret": None}
    m = m_of(S)
    regret = opt[str(k)]["m"] - m if str(k) in opt else None
    return {"set": S, "m": m, "regret": regret}


def static_topk_table(arms, baselines, m_of, opt, budget):
    """Static top-K rows per arm/baseline: {name: {K: {set, m, regret}}}."""
    table = {}
    for name, scores in {**{a: arms[a]["mu"] for a in arms}, **baselines}.items():
        order = np.argsort(-np.asarray(scores, float))
        table[name] = {}
        for k in range(1, budget + 1):
            S = [int(j) for j in order[:k]]
            table[name][str(k)] = _story_cell(m_of, S, opt, k)
    return table


def sequential_table(J, h, beta, omega, budget, m_of, opt,
                     steps, chains, burn_in, race_mus, qe_kwargs=None):
    """Reactive greedy per arm: exact-seq / metro-seq / quantum-seq.

    Dose 1 reuses each arm's race chi; later doses re-equilibrate at the
    CURRENT field (h minus prior doses) with fresh chains, so the policy is
    reactive instead of a static truncated ranking.
    """
    table = {}

    def exact_mu(h_k):
        if len(h) < 16:
            return np.asarray(exact_susceptibility(J, h_k, beta), float).mean(axis=0)
        _, _, _, chi = _enumerate_chunked(J, h_k, beta)
        return chi.mean(axis=0)

    def chain_mu(propose, h_k, seed_offset, record=False):
        results = run_chains(J, h_k, beta, propose, steps, chains, burn_in,
                             seed_offset=seed_offset, record=record)
        return susceptibility(np.concatenate([r.states for r in results]), beta).mean(axis=0), results

    calls = {"n": 0}

    doses_log = []  # full record of every dose decision + re-equilibration chains

    def make_rank(race_mu, propose, arm_name=None):
        # per-arm closure so loop variables are bound at definition time
        cache = {}

        def rank(h_k):
            key = np.asarray(h_k, float).tobytes()
            if key not in cache:
                if race_mu is not None and key == np.asarray(h, float).tobytes():
                    cache[key] = np.asarray(race_mu, float)
                    doses_log.append({"arm": arm_name, "field_h": h_k.tolist(),
                                      "source": "race_chi", "scores": np.asarray(race_mu, float).tolist()})
                elif propose is None:
                    cache[key] = exact_mu(h_k)
                    doses_log.append({"arm": arm_name, "field_h": h_k.tolist(),
                                      "source": "exact", "scores": cache[key].tolist()})
                else:
                    calls["n"] += 1
                    mu, results = chain_mu(propose, np.asarray(h_k, float), calls["n"],
                                           record=True)
                    cache[key] = mu
                    doses_log.append({
                        "arm": arm_name, "field_h": h_k.tolist(), "source": "chains",
                        "scores": mu.tolist(), "seed_offset": calls["n"],
                        "dose_chains": [
                            {"seed": int(t["seed"]),
                             "states": t["states"].tolist(),
                             "energies": t["energies"].tolist(),
                             "accepted": t["accepted"].tolist(),
                             "proposal_params": t["proposal_params"]}
                            for t in (r.trace for r in results)
                        ],
                    })
            return cache[key]

        return rank

    for name, race_mu, propose in (
        ("exact-seq", None, None),
        ("metro-seq", race_mus["metro"], local_proposal),
        ("quantum-seq", race_mus["quantum"], QeProposal(J, h, **(qe_kwargs or {}))),
    ):
        rank = make_rank(race_mu, propose, arm_name=name)
        _order, trace = sequential_greedy(h, omega, budget, rank, m_of)
        table[name] = {}
        for k, (S, mval) in enumerate(trace, 1):
            cell = {"set": [int(i) for i in S], "m": float(mval)}
            cell["regret"] = opt[str(k)]["m"] - mval if opt else None
            table[name][str(k)] = cell
    return table, doses_log


def random_baseline(J, h, beta, omega, apply_fn, m_of, budget, n_trials=16, seed=0):
    """Mean m(S) over random sets per K, plus the always-optimal optimum row."""
    n = len(h)
    rng = np.random.default_rng(seed)
    rand = {}
    for k in range(1, budget + 1):
        vals = [m_of([int(i) for i in rng.choice(n, k, replace=False)])
                for _ in range(n_trials)]
        rand[str(k)] = {"set": [], "m": float(np.mean(vals)), "regret": None}
    return rand


def cascade_info(A, theta, tiers, problem):
    if problem == "finance":
        seeds = [int(i) for i in np.where(tiers == "core")[0][:1]]
    else:
        seeds = [int(np.argmax(A.sum(axis=0)))]
    closed = cascade_closure(A, theta, seeds)
    return {"seeds": seeds, "failed": [bool(b) for b in closed],
            "n_failed": int(closed.sum())}


# ------------------------------------------------------------ orchestrator


def run_scenario(spec, qe_kwargs=None):
    """Full scenario pipeline from a spec dict; returns the JSON payload."""
    problem = spec["problem"]
    apply_fn = apply_bailout if problem == "finance" else apply_widening
    beta = spec["beta"]
    budget = spec["budget"]
    steps, chains, burn_in = spec["steps"], spec["chains"], spec["burn_in"]

    J, h, A, tiers, meta = build_instance(spec)
    n = len(h)
    print(f"[{spec['name']}] instance n={n}, frustration={len(meta['frustration_edges'])} edges")

    exact = exact_reference(J, h, beta)
    m_of = m_of_factory(J, h, beta, spec["omega"], apply_fn)

    # optimal per budget (exhaustive, cheap: C(n,k) subset evaluations of the
    # chunked reference). Only up to n=16: at n=20 each m(S) evaluation costs
    # a 2^20 pass, and C(20,3) evaluations would add ~1 h for one number.
    opt = {}
    if m_of is not None and n <= 16:
        for k in range(1, budget + 1):
            opt[str(k)] = {"m": max(m_of(list(S)) for S in combinations(range(n), k)),
                           "set": None}

    # baselines (structure-only, beta-blind)
    if problem == "finance":
        seeds = cascade_info(A, spec["theta"], tiers, problem)["seeds"]
        baselines = {
            "strength": strength_scores(A).tolist(),
            "eigenvector": eigenvector_scores(A).tolist(),
            "debtrank": debtrank_scores(A, seeds).tolist(),
        }
    else:
        seeds = cascade_info(A, spec["theta"], tiers, problem)["seeds"]
        baselines = {
            "load": load_scores(A).tolist(),
            "eigenvector": eigenvector_scores(A).tolist(),
            "debtrank": debtrank_scores(A, seeds).tolist(),
        }

    print(f"[{spec['name']}] race: metro + quantum, {steps} steps x {chains} chains")
    arms = race(J, h, beta, steps, chains, burn_in, qe_kwargs, record=True)
    fidelity = ranking_fidelity(arms, exact["chi"] if exact else None)
    for name, f in fidelity.items():
        if f:
            print(f"[{spec['name']}] {name}: chi_relerr={f['chi_relerr']:.3f} "
                  f"mu_spearman={f['mu_spearman']:.3f}")

    race_mus = {a: arms[a]["mu"] for a in arms}
    static_table = static_topk_table(arms, baselines, m_of, opt, budget)

    print(f"[{spec['name']}] sequential policy: {budget} doses, re-equilibration "
          f"chains per dose for metro/quantum")
    seq_table, doses_log = sequential_table(J, h, beta, spec["omega"], budget, m_of, opt,
                                            steps, chains, burn_in, race_mus, qe_kwargs)
    rand_table = random_baseline(J, h, beta, spec["omega"], apply_fn, m_of, budget)

    return {
        "spec": spec,
        "meta": meta,
        "instance": {  # full matrices so every result is recomputable offline
            "J": J.tolist(),
            "h": h.tolist(),
            "A": A.tolist(),
            "beta": beta,
        },
        "tiers": [str(t) for t in tiers],
        "cascade": cascade_info(A, spec["theta"], tiers, problem),
        "exact": exact,
        "fidelity": fidelity,
        "arms": {a: {k: v for k, v in arm.items() if k != "traces"} | {
            "traces": [serialize_trace(r) for r in arm["traces"]]
        } for a, arm in arms.items()},
        "baselines": baselines,
        "intervention": {
            "kind": "bailout" if problem == "finance" else "widening",
            "omega": spec["omega"],
            "static_table": static_table,
            "sequential_table": seq_table,
            "sequential_doses_log": doses_log,
            "random_mean": rand_table,
            "optimal": opt,
        },
    }


def serialize_trace(res):
    """MCMCResult with .trace -> JSON-safe dict (full per-step record)."""
    t = res.trace
    return {
        "seed": t["seed"],
        "burn_in": t["burn_in"],
        "z0": t["z0"],
        "states": t["states"].tolist(),          # int8, steps x n
        "energies": t["energies"].tolist(),      # float, per step
        "accepted": t["accepted"].tolist(),      # bool, per step
        "proposal_params": t["proposal_params"],  # (gamma, t, r) or None per step
    }


def save_story(payload, fname):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / fname
    out.write_text(json.dumps(payload, indent=1))
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KiB)")
