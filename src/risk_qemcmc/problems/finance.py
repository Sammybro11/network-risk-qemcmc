"""Financial contagion instances in the EGJ + Ising framework.

Follows arXiv:2609.17415 (Tomar et al.): institutions hold primitive assets
and each other's equity (cross-holdings C); the dependency matrix
A = Chat (I - C)^-1 folds in all indirect ownership chains; the Ising
couplings are the symmetrised dependency J = (lam/4)(A + A.T).

Convention bridge:
    s = +1 failed -> z = +1 healthy, mapped by s = -z.
    Ferromagnetic contagion J_ij < 0 here, and a positive vulnerability
    field stays positive (h_i > 0 biases toward default).
    Covariances, hence the bailout susceptibility chi = beta Cov,
    are invariant under the global sign flip, so samplers in either
    convention measure the same chi.
"""

import numpy as np

TIERS = ("core", "intermediate", "periphery")


def tier_labels(n: int, fracs: tuple[float, float, float] = (0.2, 0.3, 0.5)):
    """Institution index -> tier name; contiguous blocks (core first)."""
    n_core = max(1, round(fracs[0] * n))
    n_inter = max(1, round(fracs[1] * n))
    labels = np.empty(n, dtype=object)
    labels[:n_core] = "core"
    labels[n_core : n_core + n_inter] = "intermediate"
    labels[n_core + n_inter :] = "periphery"
    return labels


def cross_holdings(
    n: int,
    seed: int,
    fracs: tuple[float, float, float] = (0.2, 0.3, 0.5),
    outside_min: float = 0.2,
) -> tuple[np.ndarray, np.ndarray]:
    """Random tiered cross-holding matrix C (C_ij = fraction of j owned by i).

    Core institutions hold core and intermediate equity densely; the
    periphery holds little. Every column is normalised so that
    sum_i C_ij <= 1 - outside_min, guaranteeing outside ownership
    Chat_jj > 0 and invertibility of (I - C).
    """
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
            p = density[(tiers[i], tiers[j])]
            if rng.random() < p:
                C[i, j] = rng.uniform(0.05, 0.25)
    colsum = C.sum(axis=0)
    cap = 1.0 - outside_min
    over = colsum > cap
    C[:, over] *= cap / colsum[over]
    return C, tiers


def dependency_matrix(C: np.ndarray) -> np.ndarray:
    """A = Chat (I - C)^-1: direct + indirect ownership influence."""
    chat = np.diag(1.0 - C.sum(axis=0))
    return chat @ np.linalg.inv(np.eye(len(C)) - C)


def financial_instance(
    n: int,
    seed: int,
    lam: float = 6.0,
    vuln: float = 0.0,
    fracs: tuple[float, float, float] = (0.2, 0.3, 0.5),
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Contagion Ising (J, h, A, tiers) from a synthetic EGJ network.

    J = -(lam/4)(A + A.T) (ferromagnetic in the z = +1 healthy convention),
    h_i = +vuln (vulnerability: biases toward default). The periphery is
    slightly more vulnerable (leverage-like) than the core.
    """
    C, tiers = cross_holdings(n, seed, fracs)
    A = dependency_matrix(C)
    J = -(lam / 4.0) * (A + A.T)
    tier_vuln = {"core": 0.8, "intermediate": 1.0, "periphery": 1.2}
    h = vuln * np.array([tier_vuln[t] for t in tiers])
    return J, h, A, tiers


def apply_bailout(h: np.ndarray, nodes, omega: float) -> np.ndarray:
    """Bailout as stabilising longitudinal field: h_i -> h_i - omega * b_i."""
    out = h.copy().astype(float)
    out[list(nodes)] -= omega
    return out


def cascade_closure(A: np.ndarray, theta: float, seeds) -> np.ndarray:
    """Forced contagion closure of the seed set under A_ij > theta.

    Deterministic forward iteration (the reference's w = 0 MCFP):
    x_j = 1 forces x_i = 1 whenever A_ij > theta.
    """
    failed = np.zeros(len(A), dtype=bool)
    failed[list(seeds)] = True
    while True:
        new = failed | ((A > theta) @ failed)
        if (new == failed).all():
            return failed
        failed = new


def strength_scores(A: np.ndarray) -> np.ndarray:
    """Baseline ranking: out-influence sum_i A_ij (weighted degree)."""
    return A.sum(axis=0)


def eigenvector_scores(A: np.ndarray) -> np.ndarray:
    """Baseline ranking: eigenvector centrality of the symmetrised network."""
    S = A + A.T
    v = np.ones(len(A)) / np.sqrt(len(A))
    for _ in range(200):
        w = S @ v
        norm = np.linalg.norm(w)
        if norm == 0:
            break
        v = w / norm
    return np.abs(v)


def debtrank_scores(A: np.ndarray, seeds, alpha: float = 0.85) -> np.ndarray:
    """Baseline ranking: DebtRank-style propagated distress (Battiston et al.,
    arXiv:1504.01857). Distress spreads downstream along normalised
    dependency; a node's score is the total distress it exports."""
    n = len(A)
    colsum = A.sum(axis=0)
    colsum[colsum == 0] = 1.0
    W = A / colsum
    h0 = np.zeros(n)
    h0[list(seeds)] = 1.0
    distress = np.linalg.solve(np.eye(n) - alpha * W, h0)
    return A @ distress


def spearman(a: np.ndarray, b: np.ndarray) -> float:
    """Rank correlation with average-tie ranks."""

    def ranks(x):
        order = np.argsort(x, kind="stable")
        r = np.empty(len(x))
        r[order] = np.arange(len(x))
        _, inv, counts = np.unique(x, return_inverse=True, return_counts=True)
        sums = np.zeros(len(counts))
        np.add.at(sums, inv, r)
        return sums[inv] / counts[inv]

    ra, rb = ranks(np.asarray(a, float)), ranks(np.asarray(b, float))
    ra, rb = ra - ra.mean(), rb - rb.mean()
    denom = np.sqrt((ra**2).sum() * (rb**2).sum())
    return float(ra @ rb / denom) if denom > 0 else 0.0
