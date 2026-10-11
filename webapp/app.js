import { Registry } from './registry.js';
import { Network2D, rampColor } from './ui/network2d.js';
import { drawTraces, drawRanking, drawRegret } from './ui/charts.js';
import { drawFlipHist, drawBasinHist } from './ui/mechanism.js';
import { BailoutPanel } from './ui/bailout.js';

const $ = (id) => document.getElementById(id);
const status = (msg) => { $('status').textContent = msg; };

// The encoding "binary node state + pairwise ZZ couplings + longitudinal-field
// shock" is not specific to any one domain. These are the same Hamiltonian with
// a different reading of J_ij; `scenario` links the two that are implemented.
const DOMAINS = [
  {
    name: 'Financial contagion',
    coupling: 'counterparty exposure / cross-holdings',
    tail: 'how many institutions default together',
    scenario: 's1_conglomerate_core',
  },
  {
    name: 'Traffic and logistics',
    coupling: 'shared flow between road segments or hubs',
    tail: 'how far a single closure spreads congestion',
    scenario: 's4_rush_hour',
  },
  {
    name: 'Supply-chain stress',
    coupling: 'supplier dependency',
    tail: 'probability a disruption reaches a critical part',
  },
  {
    name: 'Power-grid blackouts',
    coupling: 'line topology and load-flow sensitivity',
    tail: 'probability of a blackout above a critical size',
  },
  {
    name: 'Epidemic containment',
    coupling: 'mobility and contact between sub-populations',
    tail: 'outbreak-size distribution at a given transmissibility',
  },
  {
    name: 'Interdependent infrastructure',
    coupling: 'cross-layer dependency (power → telecom → water)',
    tail: 'correlated multi-utility failure after a disaster',
  },
  {
    name: 'Breach propagation',
    coupling: 'trust and credential reachability between hosts',
    tail: 'probability one entry point becomes domain-wide compromise',
  },
  {
    name: 'Ecological and climate tipping',
    coupling: 'co-extinction links, coupled tipping elements',
    tail: 'cascade size at a given warming level',
  },
];

class App {
  constructor() {
    this.currentAdapter = null;
    this.vizInstances = new Map();
    this.init();
  }

  async init() {
    let adapters;
    try {
      adapters = await Registry.load();
    } catch (err) {
      status(`Failed to load scenario index: ${err}`);
      return;
    }

    this.renderDomains();
    this.renderLandingCards(adapters);
    this.renderSwitcher(adapters);

    $('btn-home').addEventListener('click', () => { window.location.hash = '#/'; });
    window.addEventListener('hashchange', () => this.route());
    await this.route();
  }

  // Hash routing: #/ is the landing page, #/<scenario-id> opens a dashboard.
  // Keeping the scenario in the URL means a particular run is linkable, and
  // the browser back button does what it looks like it does.
  async route() {
    const id = window.location.hash.replace(/^#\/?/, '');
    const adapter = id && Registry.get(id);
    if (!adapter) {
      this.showLanding();
      return;
    }
    if (this.currentAdapter?.id !== adapter.id) await this.loadModule(adapter.id);
    this.showDashboard(adapter.id);
  }

  showLanding() {
    if (this.currentAdapter) this.currentAdapter.cancel();
    if (this.replayTimer) clearInterval(this.replayTimer);
    $('landing').hidden = false;
    $('dashboard').hidden = true;
    $('btn-home').hidden = true;
    window.scrollTo(0, 0);
  }

  showDashboard(id) {
    $('landing').hidden = true;
    $('dashboard').hidden = false;
    $('btn-home').hidden = false;
    for (const btn of document.querySelectorAll('#scenario-switcher button[data-id]')) {
      btn.setAttribute('aria-current', String(btn.dataset.id === id));
    }
    window.scrollTo(0, 0);
  }

  renderDomains() {
    const grid = $('domain-grid');
    grid.innerHTML = '';
    for (const d of DOMAINS) {
      const built = d.scenario && Registry.get(d.scenario);
      const el = document.createElement(built ? 'button' : 'div');
      el.className = `domain${built ? ' built' : ''}`;
      if (built) {
        el.type = 'button';
        el.addEventListener('click', () => { window.location.hash = `#/${d.scenario}`; });
      }
      el.innerHTML = `
        <div class="domain-head">
          <h3>${d.name}</h3>
          ${built ? '<span class="tag built-tag">built</span>' : ''}
        </div>
        <dl>
          <dt>J<sub>ij</sub></dt><dd>${d.coupling}</dd>
          <dt>tail question</dt><dd>${d.tail}</dd>
        </dl>
      `;
      grid.appendChild(el);
    }
  }

  renderLandingCards(adapters) {
    const wrap = $('scenario-cards');
    wrap.innerHTML = '';
    for (const adapter of adapters) {
      const e = adapter.entry;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'scenario-card';
      card.addEventListener('click', () => { window.location.hash = `#/${e.id}`; });

      const steps = (v) => (v ? `${v.toLocaleString()} steps` : `not within ${e.steps.toLocaleString()}`);
      const q = e.stepsToRank?.quantum, m = e.stepsToRank?.metro;
      const ratio = q && m ? m / q : null;
      const gap = ratio ? (ratio > 1.05 ? `${ratio.toFixed(1)}x` : 'tie') : '—';

      card.innerHTML = `
        <div class="card-tags">
          <span class="tag ${e.problem}">${e.problem}</span>
          <span class="tag">n = ${e.n}</span>
          <span class="tag">${e.kind}</span>
          <span class="tag">${e.steps.toLocaleString()} x ${e.chains} chains</span>
        </div>
        <h3>${e.title}</h3>
        <p class="card-story">${e.story}</p>
        <div class="card-headline">
          <div class="row"><span>Steps to a trustworthy answer</span><span></span></div>
          <div class="row"><span class="q">QeMCMC</span><span class="q">${steps(q)}</span></div>
          <div class="row"><span class="m">Metropolis</span><span class="m">${steps(m)}</span></div>
          <div class="row"><span class="gap">Iteration-budget gap</span><span class="gap">${gap}</span></div>
        </div>
        <span class="card-cta">Open scenario →</span>
      `;
      wrap.appendChild(card);
    }
    $('chooser-foot').textContent =
      `Time to accuracy is the first prefix of the recorded chains to reach Spearman >= 0.9 ` +
      `against exact truth AND chi relative error <= 0.1 — the same definition the README ` +
      `uses. Prefixes of one run measure within-run convergence, not independent restarts.`;
  }

  renderSwitcher(adapters) {
    const nav = $('scenario-switcher');
    nav.innerHTML = '<span class="switch-label">Scenario</span>';
    for (const adapter of adapters) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.id = adapter.id;
      btn.textContent = adapter.entry.title;
      btn.addEventListener('click', () => { window.location.hash = `#/${adapter.id}`; });
      nav.appendChild(btn);
    }
  }

  async loadModule(id) {
    if (this.currentAdapter) this.currentAdapter.cancel();
    if (this.replayTimer) clearInterval(this.replayTimer);

    this.currentAdapter = Registry.get(id);
    const adapter = this.currentAdapter;

    $('module-name').innerHTML = adapter.name;
    $('module-intro-container').innerHTML = '';

    const controls = $('module-actions');
    controls.innerHTML = '';

    const replayBtn = document.createElement('button');
    replayBtn.id = 'btn-replay';
    replayBtn.type = 'button';
    replayBtn.textContent = 'Replay recorded run';
    replayBtn.disabled = true;
    controls.appendChild(replayBtn);

    const liveBtn = document.createElement('button');
    liveBtn.id = 'btn-live';
    liveBtn.type = 'button';
    liveBtn.textContent = 'Run live in browser';
    liveBtn.disabled = true;
    controls.appendChild(liveBtn);

    adapter.schema.inputs.forEach((input) => {
      const label = document.createElement('label');
      label.textContent = input.label;
      const el = document.createElement('input');
      el.id = `input-${input.id}`;
      el.type = input.type;
      if (input.min !== undefined) el.min = input.min;
      if (input.max !== undefined) el.max = input.max;
      if (input.step !== undefined) el.step = input.step;
      el.value = input.default;
      label.appendChild(el);
      controls.appendChild(label);
    });

    status(`Loading ${adapter.name}...`);
    try {
      await adapter.loadData();
      $('module-description').textContent = adapter.description;
      this.renderWorkspace();
      this.renderMethodology();
      this.bindEvents();
      this.replay();
    } catch (err) {
      status(`Failed to load data: ${err}`);
      throw err;
    }
  }

  renderWorkspace() {
    const adapter = this.currentAdapter;
    const workspace = $('module-workspace');
    workspace.innerHTML = '';
    this.vizInstances.clear();

    adapter.getVisualizations().forEach((viz) => {
      const section = document.createElement('section');
      section.className = 'panel';
      if (viz.type === 'network') section.classList.add('network-container');

      const header = document.createElement('header');
      header.className = 'panel-header';
      header.innerHTML = `<h2>${viz.title}</h2><p class="hint">${viz.hint}</p>`;
      section.appendChild(header);

      if (viz.type === 'network') {
        const canvas = document.createElement('canvas');
        canvas.className = 'network';
        canvas.id = `viz-${viz.id}`;
        section.appendChild(canvas);
        if (viz.legend) section.appendChild(this.buildNetworkLegend(viz.legend));
        workspace.appendChild(section);
        this.vizInstances.set('network', new Network2D(canvas, viz.data));
      } else if (viz.type === 'timeseries') {
        const chartsDiv = document.createElement('div');
        chartsDiv.className = 'charts';
        for (const id of ['chart-trace', 'chart-conv']) {
          const c = document.createElement('canvas');
          c.id = id;
          chartsDiv.appendChild(c);
        }
        section.appendChild(chartsDiv);

        const statsGrid = document.createElement('div');
        statsGrid.id = 'sampler-stats';
        statsGrid.className = 'stat-grid';
        section.appendChild(statsGrid);
        workspace.appendChild(section);
      } else if (viz.type === 'mechanism') {
        const chartsDiv = document.createElement('div');
        chartsDiv.className = 'charts';
        for (const id of ['chart-flip', 'chart-basin']) {
          const c = document.createElement('canvas');
          c.id = id;
          chartsDiv.appendChild(c);
        }
        section.appendChild(chartsDiv);
        workspace.appendChild(section);
      } else if (viz.type === 'ranking') {
        const chartsDiv = document.createElement('div');
        chartsDiv.className = 'charts';
        const c = document.createElement('canvas');
        c.id = 'chart-ranking';
        chartsDiv.appendChild(c);
        section.appendChild(chartsDiv);
        workspace.appendChild(section);
      } else if (viz.type === 'intervention') {
        const cfg = adapter.getInterventionConfig();
        const lex = cfg.lex;
        const options = Array.from({ length: cfg.budget }, (_, i) => i + 1)
          .map((k) => `<option value="${k}"${k === cfg.budget ? ' selected' : ''}>${k}</option>`)
          .join('');
        section.innerHTML = `
          <header class="panel-header">
            <h2>${viz.title}</h2>
            <p class="hint">${viz.hint}</p>
          </header>
          <div class="bailout-controls">
            <label>Budget K
              <select id="bailout-k">${options}</select>
            </label>
            <button id="bailout-clear" type="button">Clear</button>
            <span class="preset-label">Presets:</span>
            ${cfg.presets.map((p) => `
              <button class="preset${p.degenerate ? ' degenerate' : ''}" data-strategy="${p.id}"
                type="button"${p.degenerate
                  ? ' title="This baseline is a constant on this instance, so it ranks nothing — it picks the lowest indices by tie order."'
                  : ''}>${p.label}${p.degenerate ? ' ⚠' : ''}</button>`).join('')}
          </div>
          <div id="bank-picker" class="bank-picker" role="group" aria-label="${lex.Unit}s"></div>
          <div class="charts" style="padding-bottom: 0;">
            <canvas id="chart-regret" height="150" aria-label="Intervention regret chart"></canvas>
          </div>
          <div id="bailout-result" class="bailout-result" role="status"></div>
        `;
        workspace.appendChild(section);

        const panel = new BailoutPanel({
          ...cfg,
          onSelection: (nodes) => {
            const net = this.vizInstances.get('network');
            if (net) net.setSelected(nodes);
          },
        });
        this.vizInstances.set('intervention', panel);

        const net = this.vizInstances.get('network');
        if (net) {
          net.onNodeClick = (i) => {
            const btn = $('bank-picker').children[i];
            if (btn) btn.click();
          };
        }
      }
    });
  }

  // Swatches are drawn with the same constants the canvas uses, so the legend
  // cannot drift away from what is actually on screen.
  buildNetworkLegend({ items, callout }) {
    const wrap = document.createElement('div');
    wrap.className = 'net-legend';

    const swatch = (item) => {
      if (item.kind === 'ramp') {
        return `<span class="sw sw-ramp" style="background:linear-gradient(90deg,${rampColor(0)},${rampColor(1)})"></span>`;
      }
      if (item.kind === 'size') {
        return `<span class="sw sw-size"><i style="width:6px;height:6px"></i><i style="width:13px;height:13px"></i></span>`;
      }
      if (item.kind === 'dash') {
        return `<span class="sw sw-dash">${item.patterns
          .map((_, k) => `<i class="d${k}"></i>`).join('')}</span>`;
      }
      if (item.kind === 'edge') {
        return `<span class="sw sw-edge"><i class="ferro"></i>${item.frustrated ? '<i class="frus"></i>' : ''}</span>`;
      }
      if (item.kind === 'mark') return `<span class="sw sw-mark">Q</span>`;
      return `<span class="sw sw-seed"></span>`;
    };

    wrap.innerHTML = `
      <ul>
        ${items.map((it) => `
          <li>
            ${swatch(it)}
            <span class="leg-text">
              <b>${it.kind === 'mark' ? 'Q marker' : it.label}</b>
              <span>${it.note}</span>
            </span>
          </li>`).join('')}
      </ul>
      <p class="leg-callout">${callout}</p>
    `;
    return wrap;
  }

  renderMethodology() {
    const meta = this.currentAdapter.getMetadata();
    let html = '';
    if (meta.assumptions) {
      html += '<p><strong>Assumptions:</strong> ' + meta.assumptions.join('; ') + '</p>';
    }
    html += '<ul class="references">';
    meta.references.forEach((ref) => { html += `<li>${ref}</li>`; });
    html += '</ul>';
    html += `<p class="attribution">${meta.attribution}</p>`;
    $('methodology-content').innerHTML = html;
  }

  renderSolution() {
    const sol = this.currentAdapter.getSolution();
    if (!sol) return;
    $('module-solution').style.display = 'block';
    $('solution-content').innerHTML = `
      <div class="solution-item"><strong>Problem</strong> <span>${sol.problem}</span></div>
      <div class="solution-item"><strong>Result</strong> <span>${sol.result}</span></div>
      <div class="solution-item"><strong>Recommended Action</strong> <span>${sol.recommendedAction}</span></div>
      <div class="solution-item"><strong>Method</strong> <span>${sol.method}</span></div>
      <div class="solution-item"><strong>Constraints</strong> <span>${sol.constraints}</span></div>
    `;
  }

  bindEvents() {
    $('btn-replay').disabled = false;
    $('btn-live').disabled = false;
    $('btn-replay').addEventListener('click', () => this.replay());
    $('btn-live').addEventListener('click', () => this.runLive());

    // Belt and braces against the resize loop the canvases used to drive:
    // coalesce into one animation frame, and ignore notifications where the
    // observed width did not actually change (heights move on their own as
    // panels reflow, and reacting to that is what oscillated).
    if (!this.resizeObserver) {
      let pending = false;
      this.resizeObserver = new ResizeObserver((entries) => {
        const w = Math.round(entries[0].contentRect.width);
        if (w === this._lastWidth || pending) return;
        this._lastWidth = w;
        pending = true;
        requestAnimationFrame(() => {
          pending = false;
          if (!this.isLive && this.currentAdapter && this.currentAdapter.data) this.updateCharts();
        });
      });
      this.resizeObserver.observe($('module-workspace'));
    }
  }

  // Animates the recorded traces back in; the chains themselves are already
  // on disk, so this is presentation only.
  replay() {
    this.currentAdapter.cancel();
    if (this.replayTimer) clearInterval(this.replayTimer);
    status('Replaying recorded run...');

    const rData = this.currentAdapter.getReplayData();
    const frames = 40;
    const stepFrames = Math.max(1, Math.floor(rData.qE.length / frames));
    let t = 0;

    this.replayTimer = setInterval(() => {
      t += stepFrames;
      if (t >= rData.qE.length) {
        clearInterval(this.replayTimer);
        status('Replay finished. Inspect the mechanism panel, try the policy lab, or run live.');
        this.updateCharts();
        this.renderSolution();
        return;
      }
      this.drawRace(rData, t);
    }, 50);

    this.updateCharts();
    this.renderSolution();
  }

  // QeMCMC is drawn first so the classical arm -- the one that goes flat and
  // stays flat -- is never buried under it.
  drawRace(rData, upTo = Infinity) {
    const cut = (ys) => (upTo === Infinity ? ys : ys.slice(0, upTo));
    drawTraces($('chart-trace'), [
      { name: 'QeMCMC', color: '#62B6CF', ys: cut(rData.qE) },
      { name: 'Metropolis', color: '#F08A73', ys: cut(rData.mE) },
    ], { reference: rData.exactEnergy, yLabel: 'running mean energy' });

    drawTraces($('chart-conv'), [
      { name: 'QeMCMC', color: '#62B6CF', ys: cut(rData.qM), alpha: 0.75, width: 1 },
      { name: 'Metropolis', color: '#F08A73', ys: cut(rData.mM), alpha: 0.85, width: 1 },
    ], { reference: rData.exactM, yLabel: 'magnetization m' });
  }

  async runLive() {
    this.currentAdapter.cancel();
    if (this.replayTimer) clearInterval(this.replayTimer);

    $('btn-live').disabled = true;
    this.isLive = true;
    const config = {};
    if ($('input-steps')) config.steps = +$('input-steps').value;

    try {
      const results = await this.currentAdapter.run(config, (done, total, out) => {
        if (out) {
          const net = this.vizInstances.get('network');
          if (net) net.setStates(out.states);
          drawTraces($('chart-trace'), out.traces, { reference: out.exactEnergy, yLabel: 'chain energy' });
          drawTraces($('chart-conv'), out.convergence, { reference: out.exactM, yLabel: 'magnetization m' });
        }
        status(`Running live race: pooled step ${done}/${total}...`);
      });
      status('Live run complete — the panel below now reports the LIVE numbers.');
      this.updateCharts(results);
      this.renderSolution();
    } catch (err) {
      if (err.message !== 'cancelled') status(`Error: ${err.message}`);
    } finally {
      this.isLive = false;
      $('btn-live').disabled = false;
    }
  }

  updateCharts(resultsOverride = null) {
    const adapter = this.currentAdapter;
    const res = resultsOverride || adapter.getResults();
    const { stats, ranking } = res;

    if ($('sampler-stats')) {
      const cell = (cls, arm, value, label) => `<div class="stat ${cls}">${arm}<b>${value}</b>${label}</div>`;
      const num = (v, d = 3) => (v === null || v === undefined || Number.isNaN(v) ? '—' : (+v).toFixed(d));
      const cost = (s) =>
        s.msPerStep ? `${s.msPerStep.toFixed(s.msPerStep < 1 ? 2 : 1)} ms/step` : `${s.label} run`;
      $('sampler-stats').innerHTML = [
        cell('quantum', 'QeMCMC', num(stats.quantum.rho), 'rank fidelity &rho;'),
        cell('quantum', 'QeMCMC', num(stats.quantum.relerr), '&chi; relative err'),
        cell('quantum', 'QeMCMC', `${(100 * stats.quantum.acc).toFixed(1)}%`, `acceptance · ${cost(stats.quantum)}`),
        cell('metro', 'Metro', num(stats.metro.rho), 'rank fidelity &rho;'),
        cell('metro', 'Metro', num(stats.metro.relerr), '&chi; relative err'),
        cell('metro', 'Metro', `${(100 * stats.metro.acc).toFixed(1)}%`, `acceptance · ${cost(stats.metro)}`),
        cell('', 'exact', num(stats.exactEnergy, 2), '&lang;E&rang; ground truth'),
      ].join('');
    }

    if ($('chart-flip') && adapter.getMechanismData) {
      const mech = adapter.getMechanismData();
      drawFlipHist($('chart-flip'), mech.flip);
      drawBasinHist($('chart-basin'), mech.basin);
    }

    if ($('chart-ranking') && ranking) drawRanking($('chart-ranking'), ranking);

    if ($('chart-trace') && !this.isLive) this.drawRace(adapter.getReplayData());

    if ($('chart-regret') && adapter.getRegretConfig) {
      drawRegret($('chart-regret'), adapter.getRegretConfig());
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new App();
});
