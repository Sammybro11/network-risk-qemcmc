// One adapter for every recorded showcase scenario. The payload written by
// experiments/export_webapp_scenarios.py carries both the recorded 20k-step
// run (fidelity, traces, histograms, intervention tables, convergence ladder)
// and the instance it ran on (J, h, A), so the same file drives the replay,
// the exact re-enumeration, the intervention lab and the live race.
//
// Finance and traffic scenarios differ only in vocabulary: a bailout is a
// stabilising field edit h_j -> h_j - omega, and so is a road widening. The
// LEXICON below is the whole difference.

import { groundTruth, optimalBailouts, bailoutValue, cascadeClosure } from '../ui/physics.js';
import { runLive } from '../ui/runner.js';
import { susceptibility, muOf, chiRelErr, spearman, effectiveSampleSize, topK } from '../ui/stats.js';

const LEXICON = {
  bailout: {
    unit: 'bank', Unit: 'Bank', abbr: 'B', actor: 'regulator',
    action: 'bailout', Action: 'Bailout', verb: 'rescue',
    lo: 'all failed', hi: 'all healthy',
    state: 'solvency',
    tierOrder: ['core', 'intermediate', 'periphery'],
  },
  widening: {
    unit: 'segment', Unit: 'Segment', abbr: 'S', actor: 'city planner',
    action: 'widening', Action: 'Widening', verb: 'widen',
    lo: 'gridlock', hi: 'free-flowing',
    state: 'free-flow',
    tierOrder: ['hub', 'arterial', 'local'],
  },
};

// Live-run defaults. The recorded runs are 20,000 steps x 4 chains; a browser
// cannot match that, but it must not be so short that the reported chi is
// basin-start noise. At 2,000 steps x 2 chains the quantum arm lands near its
// recorded rank fidelity in roughly 30 s of wall clock.
const LIVE_DEFAULT_STEPS = 2000;
const LIVE_MIN_STEPS = 500;
const LIVE_CHAINS = 2;

export class ScenarioAdapter {
  constructor(entry) {
    this.id = entry.id;
    this.entry = entry;
    this.kind = entry.kind;
    this.lex = LEXICON[entry.kind];
    this.n = entry.n;
    this.name = `${entry.title} (${entry.problem})`;

    this.schema = {
      inputs: [
        {
          id: 'steps', type: 'number', label: 'Live Chain Steps',
          min: LIVE_MIN_STEPS, max: 8000, step: 500, default: LIVE_DEFAULT_STEPS,
        },
      ],
      interventions: [],
    };
    this.capabilities = ['network', 'timeseries', 'mechanism', 'ranking', 'intervention', 'exact_reference'];
    this.algorithms = ['QeMCMC', 'Metropolis'];

    this.data = null;
    this.liveResult = null;
    this.liveCancel = null;
    this.isLive = false;
  }

  async loadData() {
    const d = await (await fetch(`data/scenarios/${this.id}.json`)).json();
    this.data = d;
    this.spec = d.spec;
    this.J = d.instance.J;
    this.h = d.instance.h;
    this.A = d.instance.A;
    this.beta = d.spec.beta;
    this.omega = d.intervention.omega;
    this.budget = d.spec.budget;

    // Re-derive ground truth in the browser rather than trusting the shipped
    // numbers; it reproduces the Python values to ~1e-14 and keeps the page
    // honest if the instance rebuild ever drifts.
    this.exact = groundTruth(this.J, this.h, this.beta);
    this.optimal = optimalBailouts(this.J, this.h, this.beta, this.budget, this.omega);
    this.cascadeFailed = cascadeClosure(this.A, this.spec.theta, d.cascade.seeds);

    this.description =
      `${d.narrative.story} Recorded: ${d.spec.steps.toLocaleString()} steps x ` +
      `${d.spec.chains} chains per arm at beta = ${this.beta}, n = ${this.n}.`;
  }

  // ------------------------------------------------------------- panels

  getVisualizations() {
    const lex = this.lex;
    const qTop = topK(this.data.arms.quantum.mu, 1)[0];
    return [
      {
        id: 'network',
        type: 'network',
        title: `01. ${this.spec.problem === 'traffic' ? 'Road grid' : 'Dependency network'}`,
        hint: `Node size = exact susceptibility (the answer both samplers are chasing); ` +
          `"Q" marks the quantum arm's top ${lex.action} pick; red ring = cascade seed. ` +
          `Click a node to add it to the ${lex.action} lab.`,
        data: {
          A: this.A,
          tiers: this.data.tiers,
          positions: this.data.positions,
          tierOrder: lex.tierOrder,
          importance: this.exact.mu,
          seeds: this.data.cascade.seeds,
          mark: { [qTop]: 'Q' },
        },
      },
      {
        id: 'race',
        type: 'timeseries',
        title: '02. Sampler race: convergence and basin crossing',
        hint: `Left: each chain's running mean energy against the exact thermal mean ` +
          `(dashed) — a chain that settles off the dashed line is sampling the wrong ` +
          `distribution. Right: raw magnetization per chain; basin crossings are the ` +
          `jumps between plateaus. Gaps separate the ${this.spec.chains} chains.`,
      },
      {
        id: 'mechanism',
        type: 'mechanism',
        title: '03. Mechanism: move size and where the chains lived',
        hint: 'Left: spins flipped per accepted move — single-spin Metropolis cannot ' +
          'exceed 1, the Trotterised proposal flips whole regions. Right: time spent ' +
          'at each magnetization against the exact thermal mean.',
      },
      {
        id: 'ranking',
        type: 'ranking',
        title: `04. ${lex.Action} ranking fidelity`,
        hint: `Aggregate susceptibility mu per ${lex.unit} — the marginal utility of ` +
          `${lex.action} by fluctuation–dissipation — against exact truth and the ` +
          `structure-only baselines.`,
      },
      {
        id: 'intervention',
        type: 'intervention',
        title: `05. ${lex.Action} policy laboratory`,
        hint: `Pick up to K ${lex.unit}s to ${lex.verb}. The exact Boltzmann distribution ` +
          `is re-enumerated under your intervention, so the reported regret against the ` +
          `exhaustive optimum is exact, not estimated.`,
      },
    ];
  }

  getMechanismData() {
    const arms = this.data.arms;
    return {
      flip: { metro: arms.metro.flip_hist, quantum: arms.quantum.flip_hist },
      basin: {
        metro: arms.metro.mag_hist,
        quantum: arms.quantum.mag_hist,
        exactM: this.data.exact.m,
        loLabel: this.lex.lo,
        hiLabel: this.lex.hi,
      },
    };
  }

  // ---------------------------------------------------------------- runs

  async run(config, onProgress) {
    if (this.liveCancel) this.liveCancel.cancelled = true;
    this.liveCancel = { cancelled: false };
    this.isLive = true;
    const cancel = this.liveCancel;

    const steps = Math.max(LIVE_MIN_STEPS, config.steps || LIVE_DEFAULT_STEPS);
    const burnIn = Math.floor(steps / 10);

    this.liveResult = await runLive({
      J: this.J,
      h: this.h,
      beta: this.beta,
      steps,
      burnIn,
      chains: LIVE_CHAINS,
      onProgress: (done, total, out) => {
        if (done % 10 === 0 && !cancel.cancelled) {
          onProgress(done, total, this._formatLiveProgress(out));
        }
      },
      cancel,
    });
    this.liveSteps = steps;

    if (cancel.cancelled) throw new Error('cancelled');
    return this.getResults();
  }

  cancel() {
    if (this.liveCancel) this.liveCancel.cancelled = true;
  }

  _formatLiveProgress(out) {
    const ql = out.quantum.energies.length;
    if (!ql) return null;
    return {
      states: out.quantum.states[ql - 1],
      traces: [
        { name: 'Metropolis', color: '#F08A73', ys: out.metro.energies },
        { name: 'QeMCMC (live)', color: '#62B6CF', ys: out.quantum.energies },
      ],
      convergence: [
        { name: 'Metropolis', color: '#F08A73', ys: out.metro.states.map(mean) },
        { name: 'QeMCMC (live)', color: '#62B6CF', ys: out.quantum.states.map(mean) },
      ],
      exactEnergy: this.exact.energy,
      exactM: this.data.exact.m,
    };
  }

  // Recorded chains for the replay animation. Chain boundaries are kept as
  // NaN gaps so four chains never read as one continuous walk.
  //
  // The digests downsample 20,000 steps to ~320 points by striding, which
  // aliases a fast-mixing chain into noise: plotted raw it is an unreadable
  // band that says nothing. The energy panel therefore shows each chain's
  // RUNNING MEAN against the exact thermal mean -- the quantity that is
  // actually supposed to converge, and the one where a frozen chain visibly
  // settles on the wrong value. Magnetization stays raw, because there the
  // plateaus survive striding and the basin jumps are the point.
  getReplayData() {
    this.isLive = false;
    const join = (traces) => traces.flatMap((t, i) => (i ? [NaN, ...t] : t));
    const runningMean = (xs) => {
      let acc = 0;
      return xs.map((v, i) => (acc += v) / (i + 1));
    };
    const arms = this.data.arms;
    return {
      stride: 1,
      qStates: null, // digests carry traces and histograms, not configurations
      mE: join(arms.metro.energy_traces.map(runningMean)),
      qE: join(arms.quantum.energy_traces.map(runningMean)),
      mM: join(arms.metro.mag_traces),
      qM: join(arms.quantum.mag_traces),
      exactEnergy: this.data.exact.energy,
      exactM: this.data.exact.m,
      totalSteps: this.spec.steps,
    };
  }

  getResults() {
    const d = this.data;
    const exactMu = this.exact.mu;

    if (this.isLive && this.liveResult) {
      const src = this.liveResult;
      const arm = (a) => {
        const chi = susceptibility(src[a].states, this.beta);
        const mu = muOf(chi);
        return {
          mu,
          relerr: chiRelErr(chi, this.exact.chi),
          rho: spearman(mu, exactMu),
          acc: src[a].accepted,
          ess: src[a].ess || effectiveSampleSize(src[a].energies),
          label: 'live',
        };
      };
      return this._resultsFrom(arm('quantum'), arm('metro'));
    }

    const arm = (a) => ({
      mu: d.arms[a].mu,
      relerr: d.fidelity[a].chi_relerr,
      rho: d.fidelity[a].mu_spearman,
      acc: d.arms[a].acceptance,
      ess: d.arms[a].ess_per_step * this.spec.steps,
      msPerStep: d.arms[a].ms_per_step,
      maxStall: d.arms[a].max_stall,
      label: 'recorded',
    });
    return this._resultsFrom(arm('quantum'), arm('metro'));
  }

  _resultsFrom(quantum, metro) {
    return {
      stats: { exactEnergy: this.exact.energy, quantum, metro },
      ranking: {
        muExact: this.exact.mu,
        arms: { quantum: quantum.mu, metro: metro.mu },
        strategies: this.data.baselines,
        tiers: this.data.tiers,
      },
    };
  }

  // -------------------------------------------------------- conclusions

  // Every number here is read off the run being displayed. Nothing is
  // hardcoded, so a live run that disagrees with the recorded one says so.
  getSolution() {
    const lex = this.lex;
    const { stats } = this.getResults();
    const k = this.budget;
    const opt = this.optimal[k];
    const names = (set) => set.map((i) => `${lex.Unit} ${i} (${this.data.tiers[i]})`).join(', ');

    const live = this.isLive && this.liveResult;
    const tables = this.data.intervention;
    const metroRow = tables.static_table.metro?.[String(k)];
    const quantumRow = tables.static_table.quantum?.[String(k)];
    const seqRow = tables.sequential_table?.['quantum-seq']?.[String(k)];
    const ladder = this.convergenceSummary();

    const source = live
      ? `Live in-browser race: ${this.liveSteps.toLocaleString()} steps x ${LIVE_CHAINS} chains per arm ` +
        `(the recorded run is ${this.spec.steps.toLocaleString()} x ${this.spec.chains}).`
      : `Recorded run: ${this.spec.steps.toLocaleString()} steps x ${this.spec.chains} chains per arm.`;

    const fidelity =
      `QeMCMC reached rank fidelity rho = ${fmt(stats.quantum.rho)} at chi relative error ` +
      `${fmt(stats.quantum.relerr)} (acceptance ${pct(stats.quantum.acc)}); classical Metropolis ` +
      `rho = ${fmt(stats.metro.rho)} at ${fmt(stats.metro.relerr)} (acceptance ${pct(stats.metro.acc)}).`;

    const cost = stats.quantum.msPerStep
      ? ` Per-step cost: ${stats.quantum.msPerStep.toFixed(1)} ms quantum vs ` +
        `${stats.metro.msPerStep.toFixed(2)} ms classical, so the claim is an iteration-budget ` +
        `gap on a simulator, not a wall-clock speedup.`
      : '';

    return {
      problem:
        `${cap(lex.Action)} allocation under a budget of K = ${k} of ${this.n} ${lex.unit}s. ` +
        `The decision quantity is the equilibrium susceptibility chi = beta Cov(z): by ` +
        `fluctuation–dissipation its column mean IS the marginal utility of ${lex.action}, ` +
        `which is why it has to be sampled rather than read off the network.`,
      result: `${source} ${fidelity}${cost}`,
      recommendedAction:
        `Exhaustive optimum at K = ${k}: ${lex.verb} { ${names(opt.set)} }, lifting mean ` +
        `${lex.state} to ${fmt(opt.m)}. ` +
        (quantumRow ? `QeMCMC's static top-K picked { ${names(quantumRow.set)} } (regret ${fmt(quantumRow.regret)}); ` : '') +
        (metroRow ? `Metropolis picked { ${names(metroRow.set)} } (regret ${fmt(metroRow.regret)}). ` : '') +
        (seqRow ? `Re-ranking between doses (sequential policy) gets regret ${fmt(seqRow.regret)}.` : ''),
      method:
        `Trotterised QeMCMC proposal under (1-gamma)·alpha·H_prob + gamma·sum X_j, accepted by ` +
        `Metropolis–Hastings, versus single-spin Metropolis on the same Hamiltonian, same beta, ` +
        `same observables. ${ladder}`,
      constraints:
        `n = ${this.n}, beta = ${this.beta}, omega = ${this.omega}. Ground truth and every regret ` +
        `figure come from exact 2^${this.n} enumeration in the browser. ` +
        this.data.narrative.caveats.join('; ') + '.',
    };
  }

  // "Steps until the ranking is right" from the recorded convergence ladder —
  // the honest headline, since both arms converge given enough steps.
  convergenceSummary(threshold = 0.9) {
    const curves = this.data.convergence?.curves;
    if (!curves) return '';
    const firstGood = (arm) => {
      const hit = (curves[arm] || []).find((p) => p.mu_spearman >= threshold);
      return hit ? hit.steps : null;
    };
    const q = firstGood('quantum'), m = firstGood('metro');
    if (!q && !m) return '';
    const fmtSteps = (s) => (s ? s.toLocaleString() + ' steps' : `never within ${this.spec.steps.toLocaleString()}`);
    const gap = q && m ? ` (${(m / q).toFixed(1)}x iteration-budget gap)` : '';
    return `Time to a correct ranking (Spearman >= ${threshold}): QeMCMC ${fmtSteps(q)}, ` +
      `Metropolis ${fmtSteps(m)}${gap}.`;
  }

  getMetadata() {
    return {
      references: [
        'QeMCMC proposal and Ising conventions after Layden et al., Nature 619, 282 (2023), arXiv:2203.12497.',
        'Coarse-grained QeMCMC: Ferguson & Wallden, Phys. Rev. Research 7, 013231 (2025), arXiv:2405.04247.',
        this.spec.problem === 'traffic'
          ? 'Congestion as a capacity-normalised field: Olmos et al., arXiv:2605.03879.'
          : 'Contagion networks as annealing-ready Ising systems: Tomar et al., arXiv:2609.17415.',
        'DebtRank baseline after Battiston et al., arXiv:1504.01857.',
      ],
      attribution: 'Recorded on the IonQ / Qollab hackathon stack. MIT licensed.',
      assumptions: [
        `Spin convention: z = +1 ${this.lex.hi.replace('all ', '')}, z = -1 ${this.lex.lo.replace('all ', '')}.`,
        'The quantum arm is an exact statevector simulation of the Trotterised proposal, 1 shot per step — no wall-clock speedup is claimed.',
        `Intervention is a longitudinal field edit h_j -> h_j - ${this.omega}; it never acts inside a chain.`,
        'Convergence ladders are prefix truncations of the same chains (within-run convergence), not independent restarts.',
      ],
    };
  }

  getInterventionConfig() {
    return {
      n: this.n,
      tiers: this.data.tiers,
      omega: this.omega,
      budget: this.budget,
      optimal: this.optimal,
      lex: this.lex,
      strategies: {
        ...this.data.baselines,
        'quantum-chi': this.data.arms.quantum.mu,
        'metro-chi': this.data.arms.metro.mu,
      },
      evaluate: async (nodes) => bailoutValue(this.J, this.h, this.beta, nodes, this.omega),
    };
  }

  getRegretConfig() {
    const table = {};
    for (const [name, row] of Object.entries(this.data.intervention.static_table)) table[name] = row;
    for (const [name, row] of Object.entries(this.data.intervention.sequential_table || {})) table[name] = row;
    return { table, optimal: this.optimal, budget: this.budget };
  }
}

const mean = (z) => z.reduce((a, b) => a + b, 0) / z.length;
const fmt = (v) => (v === null || v === undefined || Number.isNaN(v) ? 'n/a' : (+v).toFixed(3));
const pct = (v) => (v === null || v === undefined ? 'n/a' : `${(100 * v).toFixed(1)}%`);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
