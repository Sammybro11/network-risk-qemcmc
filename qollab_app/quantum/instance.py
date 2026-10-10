"""EGJ financial contagion instance builder (numpy only, Pyodide-safe).

Mirror of risk_qemcmc.problems.finance for in-browser runs: tiered
cross-holdings network, dependency matrix A = Chat (I - C)^-1, Ising
couplings J = -(lam/4)(A + A.T) in the z = +1 healthy convention.

Follows arXiv:2609.17415 (Tomar et al.).
"""

import numpy as np

TIERS = ("core", "intermediate", "periphery")


def tier_labels(n, fracs=(0.2, 0.3, 0.5)):
    n_core = max(1, round(fracs[0] * n))
    n_inter = max(1, round(fracs[1] * n))
    labels = np.empty(n, dtype=object)
    labels[:n_core] = "core"
    labels[n_core : n_core + n_inter] = "intermediate"
    labels[n_core + n_inter :] = "periphery"
    return labels


def cross_holdings(n, seed, fracs=(0.2, 0.3, 0.5), outside_min=0.2):
    """Random tiered cross-holding matrix C; column sums <= 1 - outside_min."""
    rng = np.random.default_rng(seed)
    tiers = tier_labels(n, fracs)
    density = {
        ("core", "core"): 0.8,
        ("core", "intermediate"): 0.5,
        ("intermediate", "core"): 0.5,
        ("core", "periphery"): 0.25,
        ("intermediate", "intermediate"): 0.4,
        ("periphery", "core"): 0.15,
        ("intermediate", "periphery"): 0.15,
        ("periphery", "intermediate"): 0.1,
        ("periphery", "periphery"): 0.05,
    }
    C = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            if rng.random() < density[(tiers[i], tiers[j])]:
                C[i, j] = rng.uniform(0.05, 0.25)
    colsum = C.sum(axis=0)
    cap = 1.0 - outside_min
    over = colsum > cap
    C[:, over] *= cap / colsum[over]
    return C, tiers


def dependency_matrix(C):
    chat = np.diag(1.0 - C.sum(axis=0))
    return chat @ np.linalg.inv(np.eye(len(C)) - C)


def build(n, seed, lam, vuln):
    """Return plain-JS-convertible instance dict: J, h, A, tiers."""
    C, tiers = cross_holdings(n, seed)
    A = dependency_matrix(C)
    J = -(lam / 4.0) * (A + A.T)
    tier_vuln = {"core": 0.8, "intermediate": 1.0, "periphery": 1.2}
    h = vuln * np.array([tier_vuln[t] for t in tiers])
    return {
        "J": J.tolist(),
        "h": h.tolist(),
        "A": A.tolist(),
        "tiers": [str(t) for t in tiers],
    }


def baselines(n, seed, seed_index):
    """Non-dynamical baseline rankings: strength, eigenvector, DebtRank."""
    C, _ = cross_holdings(n, seed)
    A = dependency_matrix(C)

    strength = A.sum(axis=0)

    S = A + A.T
    v = np.ones(n) / np.sqrt(n)
    for _ in range(200):
        w = S @ v
        norm = np.linalg.norm(w)
        if norm == 0:
            break
        v = w / norm
    eigenvector = np.abs(v)

    colsum = A.sum(axis=0)
    colsum[colsum == 0] = 1.0
    W = A / colsum
    h0 = np.zeros(n)
    h0[seed_index] = 1.0
    distress = np.linalg.solve(np.eye(n) - 0.85 * W, h0)
    debtrank = A @ distress

    return {
        "strength": strength.tolist(),
        "eigenvector": eigenvector.tolist(),
        "debtrank": debtrank.tolist(),
    }


def cascade(n, seed, theta, seeds):
    """Forced contagion closure of seeds under A_ij > theta (w = 0 MCFP)."""
    C, _ = cross_holdings(n, seed)
    A = dependency_matrix(C)
    failed = np.zeros(n, dtype=bool)
    failed[list(seeds)] = True
    while True:
        new = failed | ((A > theta) @ failed)
        if (new == failed).all():
            return [bool(b) for b in failed]
        failed = new
