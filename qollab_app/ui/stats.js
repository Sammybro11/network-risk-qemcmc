// Pure Ising/MCMC math shared by replay and live modes. No Qollab, Qiskit
// or DOM dependencies, so it stays unit-testable outside the runtime.

export function isingEnergy(z, J, h) {
  let e = 0;
  const n = z.length;
  for (let i = 0; i < n; i++) {
    e += h[i] * z[i];
    for (let j = 0; j < n; j++) e += 0.5 * z[i] * J[i][j] * z[j];
  }
  return e;
}

// Mulberry32: small deterministic PRNG so live runs are reproducible.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function metroStep(z, energy, J, h, beta, rng) {
  const n = z.length;
  const i = Math.floor(rng() * n);
  const prop = z.slice();
  prop[i] = -prop[i];
  const dE = isingEnergy(prop, J, h) - energy;
  if (dE <= 0 || rng() < Math.exp(-beta * dE)) {
    return { z: prop, energy: energy + dE, accepted: true };
  }
  return { z, energy, accepted: false };
}

// chi_ij = beta * Cov(z_i, z_j) over the rows of `states`, matching
// numpy's np.cov (unbiased, ddof = 1) as used in risk_qemcmc.
export function susceptibility(states, beta) {
  const rows = states.length;
  const n = states[0].length;
  const mean = new Array(n).fill(0);
  for (const z of states) for (let i = 0; i < n; i++) mean[i] += z[i];
  for (let i = 0; i < n; i++) mean[i] /= rows;
  const chi = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const z of states) {
    for (let i = 0; i < n; i++) {
      const di = z[i] - mean[i];
      for (let j = 0; j < n; j++) chi[i][j] += di * (z[j] - mean[j]);
    }
  }
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) chi[i][j] = (beta * chi[i][j]) / (rows - 1);
  return chi;
}

export function muOf(chi) {
  const n = chi.length;
  const mu = new Array(n).fill(0);
  for (const row of chi) for (let j = 0; j < n; j++) mu[j] += row[j];
  return mu.map((v) => v / n);
}

export function spearman(a, b) {
  const ranks = (x) => {
    const order = x.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(x.length);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
      const avg = (i + j) / 2;
      for (let k = i; k <= j; k++) r[order[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const ra = ranks(a), rb = ranks(b);
  const ma = ra.reduce((s, v) => s + v, 0) / ra.length;
  const mb = rb.reduce((s, v) => s + v, 0) / rb.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  const den = Math.sqrt(da * db);
  return den > 0 ? num / den : 0;
}

export function chiRelErr(chi, chiExact) {
  let num = 0, den = 0;
  for (let i = 0; i < chi.length; i++)
    for (let j = 0; j < chi.length; j++) {
      num += (chi[i][j] - chiExact[i][j]) ** 2;
      den += chiExact[i][j] ** 2;
    }
  return Math.sqrt(num) / Math.sqrt(den);
}

export function topK(scores, k) {
  return scores
    .map((v, i) => [v, i])
    .sort((p, q) => q[0] - p[0])
    .slice(0, k)
    .map(([, i]) => i);
}

export function cumulativeMean(xs) {
  const out = new Array(xs.length);
  let s = 0;
  for (let i = 0; i < xs.length; i++) { s += xs[i]; out[i] = s / (i + 1); }
  return out;
}
