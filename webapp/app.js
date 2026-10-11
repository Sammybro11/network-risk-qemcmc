import { Registry } from './registry.js';
import { Network2D } from './ui/network2d.js';
import { MaxCut2D } from './ui/maxcut2d.js';
import { drawTraces, drawRanking, drawRegret } from './ui/charts.js';
import { BailoutPanel } from './ui/bailout.js';
import { cumulativeMean } from './ui/stats.js';

const $ = (id) => document.getElementById(id);
const status = (msg) => { $('status').textContent = msg; };

class App {
  constructor() {
    this.currentAdapter = null;
    this.vizInstances = new Map();
    this.init();
  }

  async init() {
    const select = $('module-select');
    const adapters = Registry.getAll();

    adapters.forEach((adapter) => {
      const option = document.createElement('option');
      option.value = adapter.id;
      option.textContent = adapter.name;
      select.appendChild(option);
    });

    select.addEventListener('change', (e) => this.loadModule(e.target.value));

    // Load first module by default
    if (adapters.length > 0) {
      await this.loadModule(adapters[0].id);
    }
  }

  async loadModule(id) {
    if (this.currentAdapter) this.currentAdapter.cancel();
    if (this.replayTimer) clearInterval(this.replayTimer);

    this.currentAdapter = Registry.get(id);
    const adapter = this.currentAdapter;

    $('module-name').innerHTML = adapter.name;
    $('module-description').textContent = adapter.description;
    $('module-intro-container').innerHTML = '';

    // Render controls
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
      this.renderWorkspace();
      this.renderMethodology();
      this.bindEvents();

      // Default to replay
      this.replay();
    } catch (err) {
      status(`Failed to load data: ${err}`);
    }
  }

  renderWorkspace() {
    const adapter = this.currentAdapter;
    const workspace = $('module-workspace');
    workspace.innerHTML = '';
    this.vizInstances.clear();

    const vizConfigs = adapter.getVisualizations();

    vizConfigs.forEach((viz) => {
      const section = document.createElement('section');
      section.className = 'panel';
      if (viz.type === 'network' || viz.type === 'maxcut-graph') section.classList.add('network-container');

      const header = document.createElement('header');
      header.className = 'panel-header';
      header.innerHTML = `<h2>${viz.title}</h2><p class="hint">${viz.hint}</p>`;
      section.appendChild(header);

      if (viz.type === 'network') {
        const canvas = document.createElement('canvas');
        canvas.className = 'network';
        canvas.id = `viz-${viz.id}`;
        section.appendChild(canvas);
        workspace.appendChild(section);
        const inst = new Network2D(canvas, viz.data);
        this.vizInstances.set(viz.id, inst);
      } else if (viz.type === 'maxcut-graph') {
        const canvas = document.createElement('canvas');
        canvas.className = 'network';
        canvas.id = `viz-${viz.id}`;
        section.appendChild(canvas);
        workspace.appendChild(section);
        const inst = new MaxCut2D(canvas, {
          ...viz.data,
          onNodeClick: (node, state) => {
            adapter.currentState = [...state];
            this.updateMaxCutPanels();
          }
        });
        this.vizInstances.set(viz.id, inst);
      } else if (viz.type === 'timeseries') {
        const chartsDiv = document.createElement('div');
        chartsDiv.className = 'charts';

        const c1 = document.createElement('canvas');
        c1.id = 'chart-trace';
        chartsDiv.appendChild(c1);

        const c2 = document.createElement('canvas');
        c2.id = 'chart-conv';
        chartsDiv.appendChild(c2);

        section.appendChild(chartsDiv);

        const statsGrid = document.createElement('div');
        statsGrid.id = 'sampler-stats';
        statsGrid.className = 'stat-grid';
        section.appendChild(statsGrid);

        workspace.appendChild(section);
      } else if (viz.type === 'ranking') {
        const chartsDiv = document.createElement('div');
        chartsDiv.className = 'charts';
        const c1 = document.createElement('canvas');
        c1.id = 'chart-ranking';
        chartsDiv.appendChild(c1);
        section.appendChild(chartsDiv);
        workspace.appendChild(section);
      } else if (viz.type === 'custom-finance-intervention') {
        section.innerHTML = `
          <header class="panel-header">
            <h2>${viz.title}</h2>
            <p class="hint">${viz.hint}</p>
          </header>
          <div class="bailout-controls">
            <label>Budget K
              <select id="bailout-k">
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3" selected>3</option>
              </select>
            </label>
            <button id="bailout-clear" type="button">Clear</button>
            <span class="preset-label">Presets:</span>
            <button class="preset" data-strategy="quantum-chi" type="button">QeMCMC &chi;</button>
            <button class="preset" data-strategy="metro-chi" type="button">Metro &chi;</button>
            <button class="preset" data-strategy="strength" type="button">Strength</button>
            <button class="preset" data-strategy="eigenvector" type="button">Eigenvector</button>
            <button class="preset" data-strategy="debtrank" type="button">DebtRank</button>
          </div>
          <div id="bank-picker" class="bank-picker" role="group" aria-label="Banks"></div>
          <div class="charts" style="padding-bottom: 0;">
            <canvas id="chart-regret" height="150" aria-label="Bailout regret chart"></canvas>
          </div>
          <div id="bailout-result" class="bailout-result" role="status"></div>
        `;
        workspace.appendChild(section);

        const bcfg = adapter.getBailoutConfig();
        const bpanel = new BailoutPanel({
          ...bcfg,
          onSelection: (nodes) => {
            const net = this.vizInstances.get('network');
            if (net) net.setSelected(nodes);
          }
        });
        this.vizInstances.set('intervention', bpanel);

        const net = this.vizInstances.get('network');
        if (net) {
          net.onNodeClick = (i) => {
            const btn = $('bank-picker').children[i];
            if (btn) btn.click();
          };
        }
      } else if (viz.type === 'custom-maxcut-distribution') {
        section.innerHTML = `
          <header class="panel-header">
            <h2>${viz.title}</h2>
            <p class="hint">${viz.hint}</p>
          </header>
          <div id="maxcut-distribution" style="padding: 1rem 1.25rem;"></div>
        `;
        workspace.appendChild(section);
        this.updateMaxCutDistribution();
      } else if (viz.type === 'custom-maxcut-lab') {
        section.innerHTML = `
          <header class="panel-header">
            <h2>${viz.title}</h2>
            <p class="hint">${viz.hint}</p>
          </header>
          <div class="bailout-controls" style="margin-bottom: 0.85rem;">
            <button id="btn-greedy-opt" type="button" class="preset" style="background:#1f3347;border-color:#62B6CF;color:#62B6CF;font-weight:600;">Apply Greedy 1-Opt Step</button>
            <button id="btn-reset-qaoa" type="button" class="preset">Reset to Best QAOA Cut</button>
            <button id="btn-all-set-a" type="button" class="preset">All Set A (Cut = 0)</button>
          </div>
          <div id="maxcut-node-picker" class="bank-picker" role="group" aria-label="Nodes"></div>
          <div id="maxcut-lab-result" class="bailout-result" role="status" style="margin-top: 1rem;"></div>
        `;
        workspace.appendChild(section);
        this.initMaxCutLab();
      }
    });
  }

  updateMaxCutPanels() {
    const adapter = this.currentAdapter;
    const net = this.vizInstances.get('network');
    if (net && net.setState) net.setState(adapter.currentState);

    this.updateMaxCutDistribution();
    this.updateMaxCutLabResult();
    this.renderSolution();
  }

  updateMaxCutDistribution() {
    const el = $('maxcut-distribution');
    if (!el || !this.currentAdapter) return;
    const adapter = this.currentAdapter;
    const n = adapter.n;
    const state = adapter.currentState;
    const setA = [], setB = [];
    for (let i = 0; i < n; i++) {
      if (state[i] >= 0) setA.push(i);
      else setB.push(i);
    }
    const currentScore = adapter.evaluateCut(state);
    const totalEdges = adapter.edges.length;
    const cutRatio = totalEdges > 0 ? ((currentScore / totalEdges) * 100).toFixed(1) : 0;

    el.innerHTML = `
      <div style="display:flex; justify-content:space-between; margin-bottom: 0.75rem;">
        <div><span style="color:#62B6CF;font-weight:600;">SET A (+1)</span>: <b>${setA.length}</b> nodes <span style="color:#8892b0;font-size:0.85em;">{ ${setA.join(', ')} }</span></div>
        <div><span style="color:#F08A73;font-weight:600;">SET B (−1)</span>: <b>${setB.length}</b> nodes <span style="color:#8892b0;font-size:0.85em;">{ ${setB.join(', ')} }</span></div>
      </div>
      <div style="background:#11161d; border-radius:4px; height:20px; overflow:hidden; display:flex; margin-bottom: 0.75rem;">
        <div style="background:#48C774; width:${cutRatio}%; height:100%; transition: width 0.2s;" title="Cut edges"></div>
        <div style="background:#232b3d; width:${100 - cutRatio}%; height:100%;" title="Uncut edges"></div>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:0.9em; font-family:'IBM Plex Mono', monospace;">
        <span style="color:#48C774;">✓ Cut Edges: <b>${currentScore}</b> / ${totalEdges} (${cutRatio}%)</span>
        <span style="color:#8892b0;">Uncut Edges: <b>${totalEdges - currentScore}</b></span>
      </div>
    `;
  }

  initMaxCutLab() {
    const picker = $('maxcut-node-picker');
    if (!picker || !this.currentAdapter) return;
    const adapter = this.currentAdapter;
    picker.innerHTML = '';

    for (let i = 0; i < adapter.n; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = `mc-node-btn-${i}`;
      b.className = 'mc-node-btn';
      this._updateNodeBtn(b, i, adapter.currentState[i]);
      b.addEventListener('click', () => {
        adapter.currentState[i] *= -1;
        this.updateMaxCutPanels();
        this._updateAllNodeBtns();
      });
      picker.appendChild(b);
    }

    $('btn-greedy-opt')?.addEventListener('click', () => {
      const optRes = adapter.applyGreedyOpt();
      if (optRes) {
        status(`1-Opt: Flipped Node ${optRes.node} (+${optRes.delta} cut edges)`);
      } else {
        status(`1-Opt: Current partition is locally optimal (no 1-flip gain).`);
      }
      this.updateMaxCutPanels();
      this._updateAllNodeBtns();
    });

    $('btn-reset-qaoa')?.addEventListener('click', () => {
      adapter.currentState = [...adapter.bestQaoaState];
      status(`Reset partition to Best QAOA Cut.`);
      this.updateMaxCutPanels();
      this._updateAllNodeBtns();
    });

    $('btn-all-set-a')?.addEventListener('click', () => {
      adapter.currentState = Array(adapter.n).fill(1);
      status(`Assigned all vertices to Set A (Cut size = 0).`);
      this.updateMaxCutPanels();
      this._updateAllNodeBtns();
    });

    this.updateMaxCutLabResult();
  }

  _updateNodeBtn(btn, i, spin) {
    const inA = spin >= 0;
    btn.textContent = `N${i} · Set ${inA ? 'A' : 'B'}`;
    btn.style.borderColor = inA ? '#62B6CF' : '#F08A73';
    btn.style.color = inA ? '#62B6CF' : '#F08A73';
    btn.style.background = inA ? 'rgba(98,182,207,0.1)' : 'rgba(240,138,115,0.1)';
  }

  _updateAllNodeBtns() {
    const adapter = this.currentAdapter;
    for (let i = 0; i < adapter.n; i++) {
      const b = $(`mc-node-btn-${i}`);
      if (b) this._updateNodeBtn(b, i, adapter.currentState[i]);
    }
  }

  updateMaxCutLabResult() {
    const el = $('maxcut-lab-result');
    if (!el || !this.currentAdapter) return;
    const adapter = this.currentAdapter;
    const score = adapter.evaluateCut(adapter.currentState);
    const opt = adapter.optimalScore;
    const gap = opt - score;
    const cls = gap === 0 ? 'good' : (gap <= 1 ? 'good' : 'bad');

    el.innerHTML = `
      Current Cut: <b>${score}</b> / ${adapter.edges.length} edges; 
      Exact Global Optimum: <b>${opt}</b>; 
      Optimality Gap: <span class="${cls}">${gap === 0 ? '0 (Optimal)' : gap + ' edges'}</span>
    `;
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

  renderSolution(results) {
    const sol = this.currentAdapter.getSolution();
    if (!sol) return;

    $('module-solution').style.display = 'block';
    const content = $('solution-content');
    content.innerHTML = `
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

    if (!this.resizeObserver) {
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.isLive) {
          if (this.currentAdapter && this.currentAdapter.data) {
            this.updateCharts();
          }
        }
      });
      this.resizeObserver.observe($('module-workspace'));
    }
  }

  replay() {
    this.currentAdapter.cancel();
    if (this.replayTimer) clearInterval(this.replayTimer);

    const isMaxCut = this.currentAdapter.id === 'maxcut-optimization';
    status(`Replaying recorded run...`);
    const rData = this.currentAdapter.getReplayData();
    let t = 0;
    const stepFrames = Math.max(1, Math.floor(rData.qStates.length / 30));

    const s1Name = isMaxCut ? 'Random Search' : 'Metropolis';
    const s2Name = isMaxCut ? 'QAOA' : 'QeMCMC';
    const yLabel1 = isMaxCut ? 'cut size' : 'energy';
    const yLabel2 = isMaxCut ? 'cut size' : 'cumulative mean energy';

    this.replayTimer = setInterval(() => {
      t += stepFrames;
      if (t >= rData.qStates.length) {
        clearInterval(this.replayTimer);
        status(isMaxCut ? 'Replay finished. Try the interactive partition lab or run live.' : 'Replay finished. Try the bailout lab, or run live.');
        this.updateCharts();
        this.renderSolution();
        return;
      }
      const net = this.vizInstances.get('network');
      if (net) {
        if (net.setState) net.setState(rData.qStates[t]);
        else if (net.setStates) net.setStates(rData.qStates[t]);
      }

      drawTraces($('chart-trace'), [
        { name: s1Name, color: '#F08A73', ys: rData.mE.slice(0, t * rData.stride) },
        { name: s2Name, color: '#62B6CF', ys: rData.qE.slice(0, t * rData.stride) },
      ], { reference: rData.exactEnergy, yLabel: yLabel1 });

      drawTraces($('chart-conv'), [
        { name: s1Name, color: '#F08A73', ys: isMaxCut ? rData.mE.slice(0, t * rData.stride) : cumulativeMean(rData.mE.slice(0, t * rData.stride)) },
        { name: s2Name, color: '#62B6CF', ys: isMaxCut ? rData.qE.slice(0, t * rData.stride) : cumulativeMean(rData.qE.slice(0, t * rData.stride)) },
      ], { reference: rData.exactEnergy, yLabel: yLabel2 });
    }, 50);
    this.updateCharts();
  }

  async runLive() {
    this.currentAdapter.cancel();
    if (this.replayTimer) clearInterval(this.replayTimer);

    $('btn-live').disabled = true;
    const config = {};
    if ($('input-steps')) config.steps = +$('input-steps').value;
    if ($('input-nodes')) config.nodes = +$('input-nodes').value;

    const isMaxCut = this.currentAdapter.id === 'maxcut-optimization';
    const yLabel1 = isMaxCut ? 'cut size' : 'energy';
    const yLabel2 = isMaxCut ? 'cut size' : 'cumulative mean energy';

    try {
      const results = await this.currentAdapter.run(config, (done, total, out) => {
        if (out) {
          const net = this.vizInstances.get('network');
          if (net) {
            if (net.setState) net.setState(out.states);
            else if (net.setStates) net.setStates(out.states);
          }
          drawTraces($('chart-trace'), out.traces, { reference: out.exactEnergy, yLabel: yLabel1 });
          drawTraces($('chart-conv'), out.convergence, { reference: out.exactEnergy, yLabel: yLabel2 });
        }
        status(`Running live computation: step ${done}/${total}...`);
      });
      status(`Computation complete.`);
      this.updateCharts(results);
      this.renderSolution(results);
      if (isMaxCut) {
        this.updateMaxCutPanels();
        this._updateAllNodeBtns();
      }
    } catch (err) {
      if (err.message !== 'cancelled') status(`Error: ${err.message}`);
    } finally {
      $('btn-live').disabled = false;
    }
  }

  updateCharts(resultsOverride = null) {
    const res = resultsOverride || this.currentAdapter.getResults();
    const { stats, ranking } = res;
    const isMaxCut = this.currentAdapter.id === 'maxcut-optimization';

    // Sampler stats panel
    if ($('sampler-stats')) {
      if (isMaxCut && stats.maxcutStats) {
        const mc = stats.maxcutStats;
        $('sampler-stats').innerHTML = `
          <div class="stat quantum">QAOA Cut<b>${mc.bestQaoa} / ${mc.totalEdges}</b>${mc.cutRatio}% ratio</div>
          <div class="stat quantum">Advantage<b>${mc.gain}</b>vs random search</div>
          <div class="stat metro">Random Cut<b>${mc.bestRandom} / ${mc.totalEdges}</b>random search best</div>
          <div class="stat">Optimum<b>${mc.optimalScore} / ${mc.totalEdges}</b>exact 2^${this.currentAdapter.n} optimum</div>
        `;
      } else {
        $('sampler-stats').innerHTML = `
          <div class="stat quantum">QeMCMC<b>${stats.quantum.ess ? stats.quantum.ess.toFixed(1) : '-'}</b>ESS</div>
          <div class="stat quantum">QeMCMC<b>${stats.quantum.rho.toFixed(3)}</b>rank fidelity</div>
          <div class="stat quantum">QeMCMC<b>${stats.quantum.relerr.toFixed(3)}</b>&chi; relative err</div>
          <div class="stat metro">Metro<b>${stats.metro.ess ? stats.metro.ess.toFixed(1) : '-'}</b>ESS</div>
          <div class="stat metro">Metro<b>${stats.metro.rho.toFixed(3)}</b>rank fidelity</div>
          <div class="stat metro">Metro<b>${stats.metro.relerr.toFixed(3)}</b>&chi; relative err</div>
          <div class="stat">exact<b>${stats.exactEnergy.toFixed(2)}</b>&lang;E&rang; ground truth</div>
        `;
      }
    }

    if ($('chart-ranking') && ranking) {
      drawRanking($('chart-ranking'), ranking);
    }

    if ($('chart-trace')) {
      const rData = this.currentAdapter.getReplayData();
      if (rData) {
        const s1Name = isMaxCut ? 'Random Search' : 'Metropolis';
        const s2Name = isMaxCut ? 'QAOA' : 'QeMCMC';
        const yLabel1 = isMaxCut ? 'cut size' : 'energy';
        const yLabel2 = isMaxCut ? 'cut size' : 'cumulative mean energy';

        drawTraces($('chart-trace'), [
          { name: s1Name, color: '#F08A73', ys: rData.mE },
          { name: s2Name, color: '#62B6CF', ys: rData.qE },
        ], { reference: rData.exactEnergy, yLabel: yLabel1 });

        drawTraces($('chart-conv'), [
          { name: s1Name, color: '#F08A73', ys: isMaxCut ? rData.mE : cumulativeMean(rData.mE) },
          { name: s2Name, color: '#62B6CF', ys: isMaxCut ? rData.qE : cumulativeMean(rData.qE) },
        ], { reference: rData.exactEnergy, yLabel: yLabel2 });
      }
    }

    if ($('chart-regret')) {
      const bcfg = this.currentAdapter.getBailoutConfig ? this.currentAdapter.getBailoutConfig() : null;
      if (bcfg && this.currentAdapter.data && this.currentAdapter.data.bailout) {
        drawRegret($('chart-regret'), {
          table: this.currentAdapter.data.bailout.table,
          optimal: bcfg.optimal,
          budget: bcfg.budget
        });
      }
    }
  }
}

// Boot application
window.addEventListener('DOMContentLoaded', () => {
  new App();
});
