import { groundTruth, optimalBailouts, bailoutValue, cascadeClosure } from '../ui/physics.js';
import { runLive } from '../ui/runner.js';
import { susceptibility, muOf, chiRelErr, spearman, cumulativeMean } from '../ui/stats.js';

export class FinanceAdapter {
  constructor() {
    this.id = 'finance-contagion';
    this.name = 'Financial Contagion & Systemic Risk';
    this.description = 'Studies systemic risk in a synthetic interbank network (EGJ cross-holdings modeled as an Ising spin glass) and compares quantum-inspired sampling proposals against classical Metropolis sampling.';
    
    this.schema = {
      inputs: [
        { id: 'steps', type: 'number', label: 'Live Chain Steps', min: 50, max: 2000, step: 50, default: 400 }
      ],
      interventions: [
        { id: 'budget', type: 'select', label: 'Bailout Budget K', options: [1, 2, 3], default: 3 }
      ]
    };
    
    this.capabilities = ['network', 'timeseries', 'ranking', 'intervention', 'exact_reference'];
    this.algorithms = ['QeMCMC', 'Metropolis'];
    
    this.data = null;
    this.params = null;
    this.liveResult = null;
    this.liveCancel = null;
    this.isLive = false;
  }

  async loadData() {
    this.data = await (await fetch('data/run.json')).json();
    this.params = { n: 12, seed: 42, lam: 6.0, vuln: 0.0, beta: 2.5, omega: 2.0, theta: 0.15, budget: 3, ...this.data.params };
    this.data.exact = groundTruth(this.data.J, this.data.h, this.params.beta);
    this.optimal = optimalBailouts(this.data.J, this.data.h, this.params.beta, this.params.budget, this.params.omega);
    this.cascadeFailed = cascadeClosure(this.data.A, this.params.theta, [0]);
  }

  getVisualizations() {
    return [
      { id: 'network', type: 'network', title: '01. Interbank topology', hint: 'Core (inner), intermediate, periphery. Nodes flare red upon default spread.', data: { A: this.data.A, tiers: this.data.tiers } },
      { id: 'convergence', type: 'timeseries', title: '02. Sampler race: energy convergence', hint: 'Mean chain energy vs exact Boltzmann value (dashed).' },
      { id: 'ranking', type: 'ranking', title: '03. Systemic-risk ranking fidelity', hint: 'Per-bank aggregate susceptibility μ vs exact ground truth.' },
      { id: 'intervention', type: 'custom-finance-intervention', title: '04. Bailout policy laboratory', hint: 'Select up to K banks to rescue. The exact Boltzmann distribution is re-enumerated under intervention to calculate true regret.' }
    ];
  }

  async run(config, onProgress) {
    if (this.liveCancel) this.liveCancel.cancelled = true;
    this.liveCancel = { cancelled: false };
    this.isLive = true;
    const cancel = this.liveCancel;
    
    const steps = config.steps || 400;
    const burnIn = Math.floor(steps / 10);
    
    this.liveResult = await runLive({
      J: this.data.J,
      h: this.data.h,
      beta: this.params.beta,
      steps,
      burnIn,
      onProgress: (done, total, out) => {
        if (done % 5 === 0 && !cancel.cancelled) {
          onProgress(done, total, this._formatLiveProgress(out));
        }
      },
      cancel,
    });
    
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
        { name: 'Metropolis', color: '#F08A73', ys: cumulativeMean(out.metro.energies) },
        { name: 'QeMCMC (live)', color: '#62B6CF', ys: cumulativeMean(out.quantum.energies) },
      ],
      exactEnergy: this.data.exact.energy
    };
  }

  getResults() {
    const src = this.isLive && this.liveResult ? this.liveResult : this.data.arms;
    const exactMu = this.data.exact.mu;
    
    let quantumStats, metroStats;
    if (this.isLive && this.liveResult) {
      const chiQ = susceptibility(src.quantum.states, this.params.beta);
      const chiM = susceptibility(src.metro.states, this.params.beta);
      quantumStats = { mu: muOf(chiQ), relerr: chiRelErr(chiQ, this.data.exact.chi), rho: spearman(muOf(chiQ), exactMu), acc: src.quantum.accepted };
      metroStats = { mu: muOf(chiM), relerr: chiRelErr(chiM, this.data.exact.chi), rho: spearman(muOf(chiM), exactMu), acc: src.metro.accepted };
    } else {
      quantumStats = { mu: src.quantum.mu, relerr: src.quantum.chi_relerr, rho: src.quantum.mu_spearman, acc: src.quantum.acceptance };
      metroStats = { mu: src.metro.mu, relerr: src.metro.chi_relerr, rho: src.metro.mu_spearman, acc: src.metro.acceptance };
    }
    
    return {
      stats: {
        exactEnergy: this.data.exact.energy,
        quantum: quantumStats,
        metro: metroStats
      },
      ranking: {
        muExact: exactMu,
        arms: { quantum: quantumStats.mu, metro: metroStats.mu },
        strategies: this.data.strategies,
        tiers: this.data.tiers
      }
    };
  }

  getReplayData() {
    this.isLive = false;
    return {
      stride: this.data.arms.quantum.stride,
      qStates: this.data.arms.quantum.states,
      mE: this.data.arms.metro.energies,
      qE: this.data.arms.quantum.energies,
      exactEnergy: this.data.exact.energy,
      totalSteps: this.data.params.steps
    };
  }

  getSolution() {
    return {
      problem: 'Identify critical nodes and optimal bailout interventions to halt systemic contagion.',
      result: `Forced cascade from the core seed bank reaches ${this.cascadeFailed.filter(Boolean).length}/${this.params.n} banks.`,
      recommendedAction: 'Apply QeMCMC for susceptibility estimation to identify optimal intervention targets, outperforming Metropolis.',
      constraints: 'Interventions are evaluated by exactly re-enumerating the Boltzmann distribution under applied fields.',
      method: 'Trotterised quantum-enhanced statevector proposals (QeMCMC) vs standard single-spin Metropolis.'
    };
  }

  getMetadata() {
    return {
      references: [
        'Ising conventions and QeMCMC proposal after Layden et al. (Nature 619, 282, 2023).',
        'Contagion model after Tomar et al. (arXiv:2609.17415).',
        'DebtRank baseline after Battiston et al. (arXiv:1504.01857).'
      ],
      attribution: 'This effort is supported by Qollab & IonQ. MIT licensed.',
      assumptions: [
        'Network structure is synthetic EGJ model',
        'QeMCMC runs as exact statevector simulation'
      ]
    };
  }

  // Expose bailout specifics
  getBailoutConfig() {
    return {
      n: this.params.n,
      tiers: this.data.tiers,
      omega: this.params.omega,
      budget: this.params.budget,
      optimal: this.optimal,
      strategies: { ...this.data.strategies, 'quantum-chi': this.data.arms.quantum.mu, 'metro-chi': this.data.arms.metro.mu },
      evaluate: async (nodes) => bailoutValue(this.data.J, this.data.h, this.params.beta, nodes, this.params.omega)
    };
  }
}
