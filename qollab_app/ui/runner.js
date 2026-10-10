// Chain runners for live mode. Metropolis runs in plain JS; the quantum
// proposal builds the same Trotter circuit as risk_qemcmc.compile.trotter
// through the JS Qiskit API and samples 1 shot per step from `backend`
// (the pre-created runtime variable, so the user's backend choice applies).

import { QuantumCircuit } from 'qiskit';
import { isingEnergy, metroStep, makeRng } from './stats.js';

const GAMMA_RANGE = [0.25, 0.6];
const TIME_RANGE = [2.0, 20.0];
const DELTA_T = 0.8;

function mixerWeight(J, h) {
  const n = h.length;
  let prob = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) prob += J[i][j] * J[i][j];
    prob += h[i] * h[i];
  }
  return Math.sqrt(n) / Math.sqrt(prob);
}

function trotterCircuit(J, h, alpha, gamma, time, r, initialBits) {
  const n = h.length;
  const dt = time / r;
  const qc = QuantumCircuit(n, n);
  const all = Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < n; i++) if (initialBits[i]) qc.x(i);
  for (let s = 0; s < r; s++) {
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (J[i][j] !== 0)
          qc.rzz(2 * (1 - gamma) * alpha * dt * J[i][j], i, j);
    for (let i = 0; i < n; i++)
      if (h[i] !== 0) qc.rz(2 * (1 - gamma) * alpha * dt * h[i], i);
    qc.barrier();
    for (let i = 0; i < n; i++) qc.rx(2 * gamma * dt, i);
  }
  qc.measure(all, all);
  return qc;
}

function firstCountKey(counts) {
  if (counts instanceof Map) return counts.keys().next().value;
  return Object.keys(counts)[0];
}

async function quantumPropose(z, J, h, alpha, rng) {
  const gamma = GAMMA_RANGE[0] + rng() * (GAMMA_RANGE[1] - GAMMA_RANGE[0]);
  const time = TIME_RANGE[0] + rng() * (TIME_RANGE[1] - TIME_RANGE[0]);
  const r = Math.max(1, Math.floor(time / DELTA_T));
  const bits = z.map((v) => (1 - v) / 2);
  const qc = trotterCircuit(J, h, alpha, gamma, time, r, bits);
  const job = await backend.run(qc, { shots: 1 });
  const counts = (await job.result()).get_counts().toJs();
  // qiskit little-endian: reverse so position i is qubit i
  const outBits = firstCountKey(counts).replace(/\s/g, '').split('').reverse().map(Number);
  return outBits.map((b) => 1 - 2 * b);
}

// Drives one chain of each arm concurrently; onStep fires per completed
// step pair so the UI can redraw. cancel.cancelled stops the loops.
export async function runLive({ J, h, beta, steps, burnIn, seed = 7, onStep, cancel = {} }) {
  const n = h.length;
  const alpha = mixerWeight(J, h);
  const rngM = makeRng(seed);
  const rngQ = makeRng(seed + 1);
  let zm = new Array(n).fill(1);
  let zq = new Array(n).fill(1);
  let em = isingEnergy(zm, J, h);
  let eq = isingEnergy(zq, J, h);
  const out = {
    metro: { energies: [], states: [], accepted: 0 },
    quantum: { energies: [], states: [], accepted: 0 },
  };
  const total = burnIn + steps;
  for (let i = 0; i < total; i++) {
    if (cancel.cancelled) break;
    const sm = metroStep(zm, em, J, h, beta, rngM);
    zm = sm.z; em = sm.energy;
    const prop = await quantumPropose(zq, J, h, alpha, rngQ);
    const ep = isingEnergy(prop, J, h);
    const dE = ep - eq;
    const qAccepted = dE <= 0 || rngQ() < Math.exp(-beta * dE);
    if (qAccepted) { zq = prop; eq = ep; }
    if (i >= burnIn) {
      out.metro.energies.push(em);
      out.metro.states.push(zm.slice());
      out.metro.accepted += sm.accepted ? 1 : 0;
      out.quantum.energies.push(eq);
      out.quantum.states.push(zq.slice());
      out.quantum.accepted += qAccepted ? 1 : 0;
      if (onStep) onStep(out.metro.energies.length - 1, zm, zq, em, eq);
    }
  }
  out.metro.accepted /= Math.max(1, out.metro.energies.length);
  out.quantum.accepted /= Math.max(1, out.quantum.energies.length);
  return out;
}
