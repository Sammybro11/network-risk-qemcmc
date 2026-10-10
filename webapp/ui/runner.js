// Chain runners for live mode. Metropolis runs in plain JS; the quantum
// proposal is the same Trotterised circuit as risk_qemcmc.compile.trotter,
// simulated here with a tiny exact statevector engine (no qiskit/backend
// needed on a static page): 1 shot per step, sampled from the true final
// state probabilities.

import { isingEnergy, metroStep, makeRng } from './stats.js';

const GAMMA_RANGE = [0.25, 0.6];
const TIME_RANGE = [2.0, 20.0];
const DELTA_T = 0.8;

export function mixerWeight(J, h) {
  const n = h.length;
  let prob = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) prob += J[i][j] * J[i][j];
    prob += h[i] * h[i];
  }
  return Math.sqrt(n) / Math.sqrt(prob);
}

class Statevector {
  constructor(n) {
    this.n = n;
    this.re = new Float64Array(1 << n);
    this.im = new Float64Array(1 << n);
    this.re[0] = 1;
  }

  x(i) {
    const bit = 1 << i;
    const { re, im } = this;
    for (let s = 0; s < re.length; s++) {
      if (s & bit) continue;
      const t = s | bit;
      const tr = re[t], ti = im[t];
      re[t] = re[s]; im[t] = im[s];
      re[s] = tr; im[s] = ti;
    }
  }

  rz(theta, i) {
    const c = Math.cos(theta / 2), s = Math.sin(theta / 2);
    const bit = 1 << i;
    const { re, im } = this;
    for (let s0 = 0; s0 < re.length; s0++) {
      const neg = !(s0 & bit); // z = +1 (bit 0) gets e^{-i theta/2}
      const ai = neg ? -s : s;
      const r = re[s0], m = im[s0];
      re[s0] = r * c - m * ai;
      im[s0] = m * c + r * ai;
    }
  }

  rzz(theta, i, j) {
    const c = Math.cos(theta / 2), s = Math.sin(theta / 2);
    const bi = 1 << i, bj = 1 << j;
    const { re, im } = this;
    for (let s0 = 0; s0 < re.length; s0++) {
      // Z_i Z_j eigenvalue +1 when the two qubits' bits are equal
      const neg = !(s0 & bi) === !(s0 & bj);
      const ai = neg ? -s : s;
      const r = re[s0], m = im[s0];
      re[s0] = r * c - m * ai;
      im[s0] = m * c + r * ai;
    }
  }

  rx(theta, i) {
    const c = Math.cos(theta / 2), s = Math.sin(theta / 2);
    const bit = 1 << i;
    const { re, im } = this;
    for (let s0 = 0; s0 < re.length; s0++) {
      if (s0 & bit) continue;
      const s1 = s0 | bit;
      const r0 = re[s0], m0 = im[s0], r1 = re[s1], m1 = im[s1];
      // a0' = c a0 - i s a1 ; a1' = c a1 - i s a0
      re[s0] = c * r0 + s * m1;
      im[s0] = c * m0 - s * r1;
      re[s1] = c * r1 + s * m0;
      im[s1] = c * m1 - s * r0;
    }
  }

  sampleShot(rng) {
    const probs = this.re.length;
    let total = 0;
    for (let s = 0; s < probs; s++)
      total += this.re[s] * this.re[s] + this.im[s] * this.im[s];
    const u = rng() * total;
    let acc = 0;
    for (let s = 0; s < probs; s++) {
      acc += this.re[s] * this.re[s] + this.im[s] * this.im[s];
      if (u <= acc) return s;
    }
    return probs - 1;
  }
}

export function trotterCircuit(J, h, alpha, gamma, time, r, initialBits) {
  const n = h.length;
  const dt = time / r;
  const sv = new Statevector(n);
  for (let i = 0; i < n; i++) if (initialBits[i]) sv.x(i);
  for (let s = 0; s < r; s++) {
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (J[i][j] !== 0) sv.rzz(2 * (1 - gamma) * alpha * dt * J[i][j], i, j);
    for (let i = 0; i < n; i++)
      if (h[i] !== 0) sv.rz(2 * (1 - gamma) * alpha * dt * h[i], i);
    for (let i = 0; i < n; i++) sv.rx(2 * gamma * dt, i);
  }
  return sv;
}

function quantumPropose(z, J, h, alpha, rng) {
  const gamma = GAMMA_RANGE[0] + rng() * (GAMMA_RANGE[1] - GAMMA_RANGE[0]);
  const time = TIME_RANGE[0] + rng() * (TIME_RANGE[1] - TIME_RANGE[0]);
  const r = Math.max(1, Math.floor(time / DELTA_T));
  const bits = z.map((v) => (1 - v) / 2);
  const sv = trotterCircuit(J, h, alpha, gamma, time, r, bits);
  // Spin-bit convention: z = +1 -> the |0> component, bit s>>i = 0.
  const s = sv.sampleShot(rng);
  return h.map((_, i) => 1 - 2 * ((s >> i) & 1));
}

// Mutable chain state shared by the sync and chunked runners so live runs
// can be executed in slices without per-row restart overhead.
function newChains(J, h) {
  const zm = new Array(h.length).fill(1);
  const zq = new Array(h.length).fill(1);
  return {
    zm, zq,
    em: isingEnergy(zm, J, h),
    eq: isingEnergy(zq, J, h),
    out: {
      metro: { energies: [], states: [], accepted: 0 },
      quantum: { energies: [], states: [], accepted: 0 },
    },
  };
}

// Advances one step of both arms, recording post-burn-in samples in st.out.
function stepOnce(st, J, h, beta, alpha, rngM, rngQ) {
  const sm = metroStep(st.zm, st.em, J, h, beta, rngM);
  st.zm = sm.z; st.em = sm.energy;
  const prop = quantumPropose(st.zq, J, h, alpha, rngQ);
  const ep = isingEnergy(prop, J, h);
  const dE = ep - st.eq;
  const qAccepted = dE <= 0 || rngQ() < Math.exp(-beta * dE);
  if (qAccepted) { st.zq = prop; st.eq = ep; }
  st.out.metro.energies.push(st.em);
  st.out.metro.states.push(st.zm.slice());
  st.out.metro.accepted += sm.accepted ? 1 : 0;
  st.out.quantum.energies.push(st.eq);
  st.out.quantum.states.push(st.zq.slice());
  st.out.quantum.accepted += qAccepted ? 1 : 0;
}

function dropLast(st) {
  st.out.metro.energies.pop(); st.out.metro.states.pop();
  st.out.quantum.energies.pop(); st.out.quantum.states.pop();
}

function normalized(out) {
  out.metro.accepted /= Math.max(1, out.metro.energies.length);
  out.quantum.accepted /= Math.max(1, out.quantum.energies.length);
  return out;
}

// Synchronous run: burnIn + steps on both arms; burn-in not recorded.
export function runLiveSync({ J, h, beta, steps, burnIn, seed = 7 }) {
  const alpha = mixerWeight(J, h);
  const rngM = makeRng(seed);
  const rngQ = makeRng(seed + 1);
  const st = newChains(J, h);
  for (let i = 0; i < burnIn; i++) { stepOnce(st, J, h, beta, alpha, rngM, rngQ); dropLast(st); }
  for (let i = 0; i < steps; i++) stepOnce(st, J, h, beta, alpha, rngM, rngQ);
  return normalized(st.out);
}

// Chunked live runner: yields to the event loop every few steps so the page
// stays responsive; onProgress(done, steps) drives status updates. Resolves
// the arm record {metro, quantum}; rejects when cancel.cancelled flips.
export function runLive({ J, h, beta, steps, burnIn, seed = 7, onProgress, cancel = {} }) {
  return new Promise((resolve, reject) => {
    const alpha = mixerWeight(J, h);
    const rngM = makeRng(seed);
    const rngQ = makeRng(seed + 1);
    const st = newChains(J, h);
    let burned = 0, done = 0;
    setTimeout(function slice() {
      if (cancel.cancelled) { reject(new Error('cancelled')); return; }
      let budget = 8;
      while (budget > 0 && burned < burnIn) {
        stepOnce(st, J, h, beta, alpha, rngM, rngQ);
        dropLast(st);
        burned++; budget--;
      }
      while (budget > 0 && done < steps) {
        stepOnce(st, J, h, beta, alpha, rngM, rngQ);
        done++; budget--;
      }
      if (onProgress) onProgress(done, steps, st.out);
      if (done >= steps) { resolve(normalized(st.out)); return; }
      setTimeout(slice, 0);
    }, 0);
  });
}
