// Orchestrator for the static webapp: load the recorded run + instance
// matrices shipped in data/run.json, enumerate the exact ground truth in
// JS, render the dashboard, and drive replay / live-in-browser modes. No
// Python and no backend anywhere.

import { Network2D } from './ui/network2d.js';
import { BailoutPanel } from './ui/bailout.js';
import { drawTraces, drawRanking, drawRegret } from './ui/charts.js';
import { runLive } from './ui/runner.js';
import { groundTruth, optimalBailouts, bailoutValue, cascadeClosure } from './ui/physics.js';
import {
  susceptibility,
  muOf,
  chiRelErr,
  spearman,
  cumulativeMean,
} from './ui/stats.js';

const $ = (id) => document.getElementById(id);
const status = (msg) => { $('status').textContent = msg; };

// Fallbacks; overwritten by data.params once the recorded run loads, so the
// app can never drift out of sync with the shipped data.
const P = { n: 12, seed: 42, lam: 6.0, vuln: 0.0, beta: 2.5, omega: 2.0, theta: 0.15, budget: 3 };

let viz = null;
let data = null; // recorded run + instance matrices
let replayTimer = null;
let liveCancel = null;

async function init() {
  status('Loading the recorded QeMCMC vs Metropolis run...');
  data = await (await fetch('data/run.json')).json();
  Object.assign(P, data.params);

  status('Enumerating the exact Boltzmann ground truth (2^12 states)...');
  await new Promise((r) => requestAnimationFrame(r)); // let the status paint
  const gt = groundTruth(data.J, data.h, P.beta);
  data.exact = gt; // same keys as the recorded block; recomputed fresh
  const optimal = optimalBailouts(data.J, data.h, P.beta, P.budget, P.omega);
  const cascadeFailed = cascadeClosure(data.A, P.theta, [0]);

  viz = new Network2D($('network'), { A: data.A, tiers: data.tiers });

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
      bailoutValue(data.J, data.h, P.beta, nodes, P.omega),
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
    'replay the recorded run or race the samplers live right here.'
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
      status('Replay finished. Try the bailout lab, or run the samplers live.');
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
      J: data.J,
      h: data.h,
      beta: P.beta,
      steps,
      burnIn,
      onProgress: (done, total, out) => {
        if (done % 5 === 0) {
          const ql = out.quantum.energies.length;
          if (ql) {
            viz.setStates(out.quantum.states[ql - 1]);
            drawTraces($('chart-trace'), [
              { name: 'Metropolis', color: '#ff7a59', ys: out.metro.energies },
              { name: 'QeMCMC (live)', color: '#4cc2ff', ys: out.quantum.energies },
            ], { reference: data.exact.energy });
            drawTraces($('chart-conv'), [
              { name: 'Metropolis', color: '#ff7a59', ys: cumulativeMean(out.metro.energies) },
              { name: 'QeMCMC (live)', color: '#4cc2ff', ys: cumulativeMean(out.quantum.energies) },
            ], { reference: data.exact.energy });
          }
          status(`Live run: step ${done}/${total}, both arms sampled in your browser...`);
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
    if (String(err.message || err) !== 'cancelled') status('Live run failed: ' + err);
    else status('Live run cancelled.');
  } finally {
    $('btn-live').disabled = false;
  }
}

init().catch((err) => status('Failed to initialise: ' + err));
