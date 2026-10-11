// Exact Boltzmann ground truth by 2^n enumeration, mirrored from
// risk_qemcmc.problems.qubo and qollab_app/quantum/exact.py. Consumes the
// J/h matrices shipped in data/scenarios/<name>.json, so page numbers are
// guaranteed to match the recorded run's Python-generated instance.

export function enumerateStates(J, h, beta) {
  const n = h.length;
  if (n >= 16) throw new Error('n too large for exact enumeration');
  const N = 1 << n;
  const states = [];
  const energies = new Float64Array(N);
  for (let s = 0; s < N; s++) {
    const z = new Array(n);
    for (let i = 0; i < n; i++) z[i] = (s >> i) & 1 ? -1 : 1;
    let e = 0;
    for (let i = 0; i < n; i++) {
      e += h[i] * z[i];
      for (let j = 0; j < n; j++) e += 0.5 * z[i] * J[i][j] * z[j];
    }
    states.push(z);
    energies[s] = e;
  }
  const lo = Math.min(...energies);
  const weights = Array.from(energies, (e) => Math.exp(-beta * (e - lo)));
  const total = weights.reduce((a, b) => a + b, 0);
  for (let s = 0; s < N; s++) weights[s] /= total;
  return { states, energies, weights };
}

export function groundTruth(J, h, beta) {
  const n = h.length;
  const { states, energies, weights } = enumerateStates(J, h, beta);
  const meanE = states.reduce((acc, _, s) => acc + weights[s] * energies[s], 0);
  const meanSpin = states[0].map((_, i) =>
    states.reduce((acc, z, s) => acc + weights[s] * z[i], 0)
  );
  const chi = states[0].map((_, i) =>
    states[0].map((_, j) => {
      const mean_ij = states.reduce((acc, z, s) => acc + weights[s] * z[i] * z[j], 0);
      return beta * (mean_ij - meanSpin[i] * meanSpin[j]);
    })
  );
  const mu = states[0].map((_, j) => chi.reduce((acc, row) => acc + row[j], 0) / n);
  return {
    energy: meanE,
    energy_std: Math.sqrt(
      states.reduce((acc, _, s) => acc + weights[s] * (energies[s] - meanE) ** 2, 0)
    ),
    mean_spin: meanSpin,
    mu,
    chi,
  };
}

// Exact magnetization m(S) with h_i -> h_i - omega on the rescued set.
export function bailoutValue(J, h, beta, nodes, omega) {
  const h2 = h.slice();
  for (const i of nodes) h2[i] -= omega;
  const { states, weights } = enumerateStates(J, h2, beta);
  return (states.reduce((acc, z, s) => acc + weights[s] * z.reduce((a, v) => a + v, 0), 0) / h.length);
}

// Exhaustive best bailout set per budget K.
export function optimalBailouts(J, h, beta, budget, omega) {
  const n = h.length;
  const out = {};
  for (let k = 1; k <= budget; k++) {
    let bestM = -Infinity, bestSet = [];
    const combos = (start, chosen) => {
      if (chosen.length === k) {
        const m = bailoutValue(J, h, beta, chosen, omega);
        if (m > bestM) { bestM = m; bestSet = [...chosen]; }
        return;
      }
      for (let i = start; i <= n - (k - chosen.length); i++) {
        chosen.push(i);
        combos(i + 1, chosen);
        chosen.pop();
      }
    };
    combos(0, []);
    out[k] = { m: bestM, set: bestSet };
  }
  return out;
}

// Forced contagion closure of seeds under A_ij > theta (w = 0 MCFP).
export function cascadeClosure(A, theta, seeds) {
  const n = A.length;
  const failed = new Array(n).fill(false);
  for (const s of seeds) failed[s] = true;
  while (true) {
    const next = failed.slice();
    for (let i = 0; i < n; i++) {
      if (failed[i]) continue;
      for (let j = 0; j < n; j++) {
        if (failed[j] && A[i][j] > theta) { next[i] = true; break; }
      }
    }
    if (next.every((f, i) => f === failed[i])) return failed;
    Object.assign(failed, next);
  }
}
