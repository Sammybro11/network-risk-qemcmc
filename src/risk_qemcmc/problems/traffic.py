"""Road-network congestion instances in the Ising framework.

Thermodynamic picture of arXiv:2605.03879 (Olmos et al.): road segments are
binary units, mobility demand acts as an effective external field favoring
congestion, and the load is capacity-normalised (VOC-like). Their city-scale
description is noninteracting; the inter-segment coupling they name as the
open extension is the spillback term here: J_ij < 0 (ferromagnetic) between
segments sharing flow, so congestion prefers agreement along heavy links.

Convention bridge:
    z = +1 free-flowing, z = -1 congested; positive load h_i > 0 biases
    toward congestion. Same (J, h) convention as qubo.py / finance.py, so
    samplers, diagnostics and exact references apply unchanged.

Because the energy is capacity-normalised, capacity relief (widening a
segment) is a longitudinal field edit h_i -> h_i - omega -- the exact map of
the finance bailout. Fluctuation-dissipation then makes chi = beta Cov(z)
the bang-per-widening ranking: chi_ij = d<z_i>/dh_j is how much segment i
decongests per unit of widening at j.
"""

import numpy as np

TIERS = ("hub", "arterial", "local")

TIER_DEMAND = {"hub": 3.0, "arterial": 1.0, "local": 0.7}
TIER_CAPACITY = {"hub": 1.5, "arterial": 1.0, "local": 1.0}


def grid_adjacency(L: int, ring: bool = True) -> np.ndarray:
    """Adjacency of an L x L grid: 4-neighbour streets, optionally closed
    by a perimeter ring road (cycle over the boundary cells). Note the ring
    only adds NEW edges for L >= 4; for L = 3 the perimeter cycle coincides
    with the grid streets, so --no-ring is a no-op there."""
    n = L * L
    A = np.zeros((n, n))
    for i in range(n):
        r, c = divmod(i, L)
        for dr, dc in ((0, 1), (1, 0)):
            r2, c2 = r + dr, c + dc
            if r2 < L and c2 < L:
                j = r2 * L + c2
                A[i, j] = A[j, i] = 1.0
    if ring and L >= 2:
        perimeter = (
            [c for c in range(L)]                       # top row, west -> east
            + [r * L + (L - 1) for r in range(1, L)]    # east col, north -> south
            + [(L - 1) * L + c for c in range(L - 2, -1, -1)]  # bottom, east -> west
            + [r * L for r in range(L - 2, 0, -1)]      # west col, south -> north
        )
        for u, v in zip(perimeter, perimeter[1:] + perimeter[:1]):
            A[u, v] = A[v, u] = 1.0
    return A


def tier_labels(A: np.ndarray, fracs: tuple[float, float, float] = (0.15, 0.35, 0.5)) -> np.ndarray:
    """Node index -> tier name; contiguous blocks in centrality order
    (grid degree desc, then proximity to the network centre): hubs first,
    arterials next, locals last."""
    n = len(A)
    L = int(np.sqrt(n))
    r0 = (L - 1) / 2
    dist = [max(abs(i // L - r0), abs(i % L - r0)) for i in range(n)]
    order = sorted(range(n), key=lambda i: (-A[i].sum(), dist[i], i))
    n_hub = max(1, round(fracs[0] * n))
    n_art = max(1, round(fracs[1] * n))
    labels = np.empty(n, dtype=object)
    labels[order[:n_hub]] = "hub"
    labels[order[n_hub : n_hub + n_art]] = "arterial"
    labels[order[n_hub + n_art :]] = "local"
    return labels


def traffic_instance(
    L: int,
    seed: int,
    lam: float = 6.0,
    vuln: float = 0.0,
    ring: bool = True,
    fracs: tuple[float, float, float] = (0.15, 0.35, 0.5),
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Congestion Ising (J, h, F, tiers) from a synthetic grid network.

    Flow F_ij = share of node i's demand entering neighbour j; the
    symmetrised flow is the shared-load coupling J = -(lam/4)(F + F.T)
    (ferromagnetic: congestion agrees along heavy links). The influence
    matrix A = F.T ranks how congestion at j back-propagates upstream to
    i; the load field h_i = vuln * demand_i / capacity_i is the
    capacity-normalised (VOC-like) pressure, so vuln = 0 gives the
    degenerate free-flow/gridlock double well.
    """
    A_grid = grid_adjacency(L, ring)
    tiers = tier_labels(A_grid, fracs)
    rng = np.random.default_rng(seed)
    demand = np.array([TIER_DEMAND[t] * rng.lognormal(0.0, 0.3) for t in tiers])
    capacity = np.array([TIER_CAPACITY[t] for t in tiers])
    degree = A_grid.sum(axis=1)
    degree[degree == 0] = 1.0
    F = A_grid * (demand / degree)[:, None]
    J = -(lam / 4.0) * (F + F.T)
    h = vuln * demand / capacity
    return J, h, F.T, tiers


def apply_widening(h: np.ndarray, nodes, omega: float) -> np.ndarray:
    """Capacity relief as a longitudinal field edit:
        for i in nodes: h_i -> h_i - omega."""
    out = h.copy().astype(float)
    out[list(nodes)] -= omega
    return out


def load_scores(A: np.ndarray) -> np.ndarray:
    """Baseline ranking: total inflow per segment (VOC load centrality)."""
    return A.sum(axis=0)