// One adapter for every recorded showcase scenario. The payload written by
// experiments/export_webapp_scenarios.py carries both the recorded 20k-step
// run (fidelity, traces, histograms, intervention tables, convergence ladder)
// and the instance it ran on (J, h, A), so the same file drives the replay,
// the exact re-enumeration and the ranking panel.
//
// Finance and traffic scenarios differ only in vocabulary: a bailout is a
// stabilising field edit h_j -> h_j - omega, and so is a road widening. The
// LEXICON below is the whole difference.

import { groundTruth, optimalBailouts, cascadeClosure } from '../ui/physics.js';
import { topK } from '../ui/stats.js';

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

export class ScenarioAdapter {
  constructor(entry) {
    this.id = entry.id;
    this.entry = entry;
    this.kind = entry.kind;
    this.lex = LEXICON[entry.kind];
    this.n = entry.n;
    this.name = `${entry.title} (${entry.problem})`;

    this.schema = { inputs: [], interventions: [] };
    this.capabilities = ['network', 'timeseries', 'mechanism', 'ranking', 'exact_reference'];
    this.algorithms = ['QeMCMC', 'Metropolis'];

    this.data = null;
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
    // Still needed by getSolution: the recorded payload ships the optimal m
    // per budget but not the winning set.
    this.optimal = optimalBailouts(this.J, this.h, this.beta, this.budget, this.omega);
    this.cascadeFailed = cascadeClosure(this.A, this.spec.theta, d.cascade.seeds);

    // Baseline keys differ by problem (finance ships `strength`, traffic ships
    // `load`), and one of them is degenerate -- see degenerateBaselines().
    this.baselineKeys = Object.keys(d.baselines);
    this.degenerate = new Set(
      this.baselineKeys.filter((k) => new Set(d.baselines[k].map((v) => v.toFixed(6))).size === 1)
    );
    // Size channel for the network map. NOT `strength`: on the EGJ dependency
    // matrix every column of A sums to exactly 1 by construction, so
    // strength_scores(A) is the constant vector and carries no ranking at all.
    this.structureKey = this.degenerate.has('eigenvector') ? null : 'eigenvector';

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
        hint: `Colour is the equilibrium answer, size is what structural centrality would ` +
          `tell you: a large dark node is well-connected but not worth ${lex.action}, ` +
          `and a small bright node is the one everyone else misses.`,
        data: {
          A: this.A,
          J: this.J,
          tiers: this.data.tiers,
          positions: this.data.positions,
          tierOrder: lex.tierOrder,
          importance: this.exact.mu,
          structure: this.structureKey ? this.data.baselines[this.structureKey] : null,
          seeds: this.data.cascade.seeds,
          mark: { [qTop]: 'Q' },
        },
        legend: this.getNetworkLegend(qTop),
      },
      {
        id: 'race',
        type: 'timeseries',
        title: '02. Sampler race: convergence and basin crossing',
        hint: `Left: each chain's running mean energy against the exact thermal mean ` +
          `⟨E⟩ (dashed). A chain that settles off the dashed line is sampling the wrong ` +
          `distribution. Right: raw magnetization per chain; basin crossings are the ` +
          `jumps between plateaus. Gaps separate the ${this.spec.chains} chains.`,
      },
      {
        id: 'mechanism',
        type: 'mechanism',
        title: '03. Mechanism: move size and where the chains lived',
        hint: 'Left: spins flipped per accepted move. Single-spin Metropolis cannot ' +
          'exceed 1, while the Trotterised proposal flips whole regions. Right: time spent ' +
          'at each magnetization against the exact thermal mean.',
      },
      {
        id: 'ranking',
        type: 'ranking',
        title: `04. ${lex.Action} ranking fidelity`,
        hint: `Aggregate susceptibility mu per ${lex.unit}, the marginal utility of ` +
          `${lex.action} by fluctuation-dissipation, against exact truth and the ` +
          `structure-only baselines. Full width, under the mechanism panel, because ` +
          `${this.n} bar groups need the room.`,
      },
    ];
  }

  // Spells out every visual channel. Without this the map is decoration: the
  // viewer has no way to know that colour and size are deliberately encoding
  // two different, disagreeing answers.
  getNetworkLegend(qTop) {
    const lex = this.lex;
    const frustrated = (this.data.meta?.frustration_edges || []).length;
    const items = [
      {
        kind: 'ramp',
        label: 'Fill: exact susceptibility μ',
        note: `the equilibrium answer: marginal gain from ${lex.action} at this ${lex.unit}`,
        ends: ['low', 'high'],
      },
      {
        kind: 'size',
        label: 'Size: eigenvector centrality',
        note: 'structure only, no temperature and no physics: what centrality would tell you',
      },
      {
        kind: 'dash',
        label: `Outline: tier`,
        note: lex.tierOrder.join(' · '),
        patterns: lex.tierOrder,
      },
      {
        kind: 'edge',
        label: 'Edge: coupling J',
        note: frustrated
          ? `solid = agreement (J < 0); dashed coral = frustrated (J > 0), ${frustrated} here`
          : 'solid = agreement (J < 0); width by |J|. No frustrated couplings in this scenario',
        frustrated: frustrated > 0,
      },
      {
        kind: 'mark',
        label: 'Q',
        note: `the quantum arm's top ${lex.action} pick`,
      },
      {
        kind: 'seed',
        label: 'Red ring',
        note: `cascade seed (${this.data.cascade.n_failed} of ${this.n} fail under forced closure)`,
      },
    ];
    // The headline the encoding exists to deliver, computed rather than asserted.
    const rank = (xs) => {
      const order = [...xs.keys()].sort((a, b) => xs[b] - xs[a]);
      const r = new Array(xs.length);
      order.forEach((idx, pos) => { r[idx] = pos + 1; });
      return r;
    };
    const rTruth = rank(this.exact.mu);
    let callout = `The quantum arm's top pick is ${lex.Unit} ${qTop} (exact rank #${rTruth[qTop]}).`;
    if (this.structureKey) {
      const rStruct = rank(this.data.baselines[this.structureKey]);
      let worst = 0;
      for (let i = 1; i < this.n; i++) {
        if (Math.abs(rTruth[i] - rStruct[i]) > Math.abs(rTruth[worst] - rStruct[worst])) worst = i;
      }
      callout =
        `Biggest disagreement here: ${lex.Unit} ${worst} ranks #${rTruth[worst]} by exact ` +
        `susceptibility but #${rStruct[worst]} by eigenvector centrality. ` + callout;
    }
    return { items, callout };
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

  // No async work behind the replay any more, but the app calls this when it
  // swaps scenarios or restarts the animation, so keep the hook.
  cancel() {}

  getResults() {
    const d = this.data;

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

  // Every number here is read off the recorded run. Nothing is hardcoded.
  getSolution() {
    const lex = this.lex;
    const { stats } = this.getResults();
    const k = this.budget;
    const opt = this.optimal[k];
    const names = (set) => set.map((i) => `${lex.Unit} ${i} (${this.data.tiers[i]})`).join(', ');

    const tables = this.data.intervention;
    const metroRow = tables.static_table.metro?.[String(k)];
    const quantumRow = tables.static_table.quantum?.[String(k)];
    const seqRow = tables.sequential_table?.['quantum-seq']?.[String(k)];
    const ladder = this.convergenceSummary();

    const source = `Recorded run: ${this.spec.steps.toLocaleString()} steps x ${this.spec.chains} chains per arm.`;

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
        `The decision quantity is the equilibrium susceptibility chi = beta Cov(z). By ` +
        `fluctuation-dissipation its column mean IS the marginal utility of ${lex.action}, ` +
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
        `Metropolis-Hastings, versus single-spin Metropolis on the same Hamiltonian, same beta, ` +
        `same observables. ${ladder}`,
      constraints:
        `n = ${this.n}, beta = ${this.beta}, omega = ${this.omega}. Ground truth and every regret ` +
        `figure come from exact 2^${this.n} enumeration in the browser. ` +
        this.data.narrative.caveats.join('; ') + '.',
    };
  }

  // "Steps until the sampler is trustworthy" from the recorded convergence
  // ladder -- the honest headline, since both arms converge given enough steps.
  // Threshold is rho >= 0.9 AND chi relerr <= 0.1, the definition used in
  // README.md; rank correlation alone clears earlier and would make the site
  // quote different gaps than the repo does.
  convergenceSummary(rhoMin = 0.9, relerrMax = 0.1) {
    const curves = this.data.convergence?.curves;
    if (!curves) return '';
    const firstGood = (arm) => {
      const hit = (curves[arm] || [])
        .find((p) => p.mu_spearman >= rhoMin && p.chi_relerr <= relerrMax);
      return hit ? hit.steps : null;
    };
    const q = firstGood('quantum'), m = firstGood('metro');
    if (!q && !m) return '';
    const fmtSteps = (s) => (s ? s.toLocaleString() + ' steps' : `never within ${this.spec.steps.toLocaleString()}`);
    const gap = q && m ? ` (${(m / q).toFixed(1)}x iteration-budget gap)` : '';
    return `Time to accuracy (Spearman >= ${rhoMin} and χ relative error <= ${relerrMax}): ` +
      `QeMCMC ${fmtSteps(q)}, Metropolis ${fmtSteps(m)}${gap}.`;
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
        'The quantum arm is an exact statevector simulation of the Trotterised proposal, 1 shot per step; no wall-clock speedup is claimed.',
        `Intervention is a longitudinal field edit h_j -> h_j - ${this.omega}; it never acts inside a chain.`,
        'Convergence ladders are prefix truncations of the same chains (within-run convergence), not independent restarts.',
      ],
    };
  }
}

const mean = (z) => z.reduce((a, b) => a + b, 0) / z.length;
const fmt = (v) => (v === null || v === undefined || Number.isNaN(v) ? 'n/a' : (+v).toFixed(3));
const pct = (v) => (v === null || v === undefined ? 'n/a' : `${(100 * v).toFixed(1)}%`);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
