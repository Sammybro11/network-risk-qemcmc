// Orchestrator: build the contagion instance in Python, load the recorded
// reference run, render the dashboard, and drive replay / live-simulator
// modes. Judges press Run; this file is the whole app entry point.

import * as instance from 'quantum.instance';
import * as exact from 'quantum.exact';
import * as loaddata from 'quantum.loaddata';
import { NetworkViz } from './ui/network.js';
import { BailoutPanel } from './ui/bailout.js';
import { drawTraces, drawRanking, drawRegret } from './ui/charts.js';
import { runLive } from './ui/runner.js';
import {
  susceptibility,
  muOf,
  chiRelErr,
  spearman,
  cumulativeMean,
} from './ui/stats.js';

const $ = (id) => document.getElementById(id);
const status = (msg) => { $('status').textContent = msg; };

// Pyodide .toJs() converts dicts to plain objects on some versions and to
// Map on others; normalise recursively so the rest of the app is agnostic.
function toPlain(x) {
  if (x instanceof Map) {
    const o = {};
    for (const [k, v] of x) o[k] = toPlain(v);
    return o;
  }
  if (Array.isArray(x)) return x.map(toPlain);
  return x;
}
const fromPy = async (promise) => toPlain((await promise).toJs());

// Fallbacks; overwritten by data.params once the recorded run loads, so the
// app can never drift out of sync with the shipped data.
const P = { n: 12, seed: 42, lam: 6.0, vuln: 0.0, beta: 2.5, omega: 2.0, theta: 0.15, budget: 3 };

let viz = null;
let data = null; // recorded run
let inst = null; // {J, h, A, tiers}
let replayTimer = null;
let liveCancel = null;

async function init() {
  status('Loading the recorded QeMCMC vs Metropolis run...');
  data = await fromPy(loaddata.recorded.callPromising());
  Object.assign(P, data.params);

  status('Building the EGJ contagion network in Python...');
  inst = await fromPy(instance.build.callPromising(P.n, P.seed, P.lam, P.vuln));
  status('Enumerating the exact Boltzmann ground truth (2^12 states)...');
  const gt = await fromPy(exact.ground_truth.callPromising(P.n, P.seed, P.lam, P.vuln, P.beta));
  const optimal = await fromPy(exact.optimal_bailouts.callPromising(
    P.n, P.seed, P.lam, P.vuln, P.beta, P.budget, P.omega));
  const cascadeFailed = await fromPy(instance.cascade.callPromising(P.n, P.seed, P.theta, [0]));

  data.exact = gt; // freshly enumerated exacts, same keys as the recorded block

  viz = new NetworkViz($('network'), { A: inst.A, tiers: inst.tiers });

  drawRanking($('chart-ranking'), {
    muExact: data.exact.mu,
    arms: { quantum: data.arms.quantum.mu, metro: data.arms.metro.mu },
    strategies: data.strategies,
    tiers: data.tiers,
  });
  drawRegret($('chart-regret'), {
    table: data.bailout.table,
    optimal: data.bailout.optimal,
    budget: P.budget,
  });
  renderStats(null);
  drawTraces($('chart-trace'), [], { reference: data.exact.energy, yLabel: 'energy' });
  drawTraces($('chart-conv'), [], { yLabel: 'cumulative mean energy' });

  new BailoutPanel({
    n: P.n,
    tiers: data.tiers,
    omega: P.omega,
    budget: P.budget,
    optimal,
    strategies: { ...data.strategies, 'quantum-chi': data.arms.quantum.mu, 'metro-chi': data.arms.metro.mu },
    evaluate: async (nodes) =>
      fromPy(exact.bailout_value.callPromising(P.n, P.seed, P.lam, P.vuln, P.beta, nodes, P.omega)),
    onSelection: (nodes) => viz.setSelected(nodes),
  });
  viz.onNodeClick = (i) => {
    const btn = $('bank-picker').children[i];
    if (btn) btn.click();
  };

  $('btn-replay').disabled = false;
  $('btn-live').disabled = false;
  $('btn-replay').addEventListener('click', replay);
  $('btn-live').addEventListener('click', live);
  status(
    `Ready. Forced cascade from the core seed bank reaches ${cascadeFailed.filter(Boolean).length}/${P.n} banks; ` +
    'replay the recorded run or race the samplers live on the simulator.'
  );
  replay();
}

function renderStats(live) {
  const src = live || data.arms;
  const exactMu = data.exact.mu;
  const cards = [];
  for (const [name, key] of [['quantum', 'quantum'], ['metro', 'metro']]) {
    const arm = src[key];
    let relerr, rho, acc;
    if (live) {
      const chi = susceptibility(arm.states, P.beta);
      const mu = muOf(chi);
      relerr = chiRelErr(chi, data.exact.chi);
      rho = spearman(mu, exactMu);
      acc = arm.accepted;
    } else {
      relerr = arm.chi_relerr;
      rho = arm.mu_spearman;
      acc = arm.acceptance;
    }
    cards.push(
      `<div class="stat ${name}">${name}<b>${rho.toFixed(3)}</b>rank fidelity (Spearman vs exact)</div>` +
      `<div class="stat ${name}">${name}<b>${relerr.toFixed(3)}</b>&chi; relative error</div>` +
      `<div class="stat ${name}">${name}<b>${acc.toFixed(2)}</b>acceptance rate</div>`
    );
  }
  cards.push(
    `<div class="stat">exact<b>${data.exact.energy.toFixed(2)}</b>ground-truth &lang;E&rang;</div>`
  );
  $('sampler-stats').innerHTML = cards.join('');
}

function stopReplay() {
  if (replayTimer) { clearInterval(replayTimer); replayTimer = null; }
}

function replay() {
  stopReplay();
  if (liveCancel) liveCancel.cancelled = true;
  const stride = data.arms.quantum.stride;
  const qStates = data.arms.quantum.states;
  const mE = data.arms.metro.energies;
  const qE = data.arms.quantum.energies;
  let t = 0;
  status(`Replaying the recorded run (${data.params.steps} steps x ${data.params.chains} chains per arm)...`);
  const stepFrames = 40;
  replayTimer = setInterval(() => {
    t += stepFrames;
    if (t >= qStates.length) {
      stopReplay();
      status('Replay finished. Try the bailout lab, or run live on the simulator.');
      return;
    }
    viz.setStates(qStates[t]);
    drawTraces($('chart-trace'), [
      { name: 'Metropolis', color: '#ff7a59', ys: mE.slice(0, t * stride) },
      { name: 'QeMCMC', color: '#4cc2ff', ys: qE.slice(0, t * stride) },
    ], { reference: data.exact.energy });
    drawTraces($('chart-conv'), [
      { name: 'Metropolis', color: '#ff7a59', ys: cumulativeMean(mE.slice(0, t * stride)) },
      { name: 'QeMCMC', color: '#4cc2ff', ys: cumulativeMean(qE.slice(0, t * stride)) },
    ], { reference: data.exact.energy });
  }, 60);
  renderStats(null);
}

async function live() {
  stopReplay();
  if (liveCancel) liveCancel.cancelled = true;
  liveCancel = { cancelled: false };
  const cancel = liveCancel;
  const steps = Math.max(50, Math.min(2000, +$('live-steps').value || 400));
  const burnIn = Math.floor(steps / 10);
  $('btn-live').disabled = true;
  try {
    const mE = [], qE = [];
    const result = await runLive({
      J: inst.J,
      h: inst.h,
      beta: P.beta,
      steps,
      burnIn,
      onStep: (i, zm, zq, em, eq) => {
        mE.push(em); qE.push(eq);
        if (i % 5 === 0) {
          viz.setStates(zq);
          drawTraces($('chart-trace'), [
            { name: 'Metropolis', color: '#ff7a59', ys: mE },
            { name: 'QeMCMC (live)', color: '#4cc2ff', ys: qE },
          ], { reference: data.exact.energy });
          drawTraces($('chart-conv'), [
            { name: 'Metropolis', color: '#ff7a59', ys: cumulativeMean(mE) },
            { name: 'QeMCMC (live)', color: '#4cc2ff', ys: cumulativeMean(qE) },
          ], { reference: data.exact.energy });
          status(`Live run: step ${i + 1}/${steps} on the selected simulator...`);
        }
      },
      cancel,
    });
    if (cancel.cancelled) return;
    renderStats(result);
    const chiQ = susceptibility(result.quantum.states, P.beta);
    const chiM = susceptibility(result.metro.states, P.beta);
    const muQ = muOf(chiQ), muM = muOf(chiM);
    drawRanking($('chart-ranking'), {
      muExact: data.exact.mu,
      arms: { quantum: muQ, metro: muM },
      strategies: data.strategies,
      tiers: data.tiers,
    });
    status(
      `Live run complete: rank fidelity vs exact = ${spearman(muQ, data.exact.mu).toFixed(3)} (QeMCMC) ` +
      `vs ${spearman(muM, data.exact.mu).toFixed(3)} (Metropolis) in ${steps} steps.`
    );
  } catch (err) {
    status('Live run failed: ' + err);
  } finally {
    $('btn-live').disabled = false;
  }
}

init().catch((err) => status('Failed to initialise: ' + err));
