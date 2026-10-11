import { Registry } from './registry.js';
import { Network2D } from './ui/network2d.js';
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
    
    adapters.forEach(adapter => {
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

    adapter.schema.inputs.forEach(input => {
      const label = document.createElement('label');
      label.textContent = input.label;
      const el = document.createElement('input');
      el.id = `input-${input.id}`;
      el.type = input.type;
      if (input.min) el.min = input.min;
      if (input.max) el.max = input.max;
      if (input.step) el.step = input.step;
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

    vizConfigs.forEach(viz => {
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
        workspace.appendChild(section);
        const inst = new Network2D(canvas, viz.data);
        this.vizInstances.set(viz.id, inst);
      } 
      else if (viz.type === 'timeseries') {
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
      }
      else if (viz.type === 'ranking') {
        const chartsDiv = document.createElement('div');
        chartsDiv.className = 'charts';
        const c1 = document.createElement('canvas');
        c1.id = 'chart-ranking';
        chartsDiv.appendChild(c1);
        section.appendChild(chartsDiv);
        workspace.appendChild(section);
      }
      else if (viz.type === 'custom-finance-intervention') {
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
        
        // Init panel
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
      }
    });
  }

  renderMethodology() {
    const meta = this.currentAdapter.getMetadata();
    let html = '';
    if (meta.assumptions) {
      html += '<p><strong>Assumptions:</strong> ' + meta.assumptions.join('; ') + '</p>';
    }
    html += '<ul class="references">';
    meta.references.forEach(ref => { html += `<li>${ref}</li>`; });
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
          // If not currently running a live loop, redraw immediately on resize
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
    
    status(`Replaying recorded run...`);
    const rData = this.currentAdapter.getReplayData();
    let t = 0;
    const stepFrames = 40;
    
    this.replayTimer = setInterval(() => {
      t += stepFrames;
      if (t >= rData.qStates.length) {
        clearInterval(this.replayTimer);
        status('Replay finished. Try the bailout lab, or run live.');
        this.updateCharts();
        this.renderSolution();
        return;
      }
      const net = this.vizInstances.get('network');
      if (net) net.setStates(rData.qStates[t]);
      
      drawTraces($('chart-trace'), [
        { name: 'Metropolis', color: '#F08A73', ys: rData.mE.slice(0, t * rData.stride) },
        { name: 'QeMCMC', color: '#62B6CF', ys: rData.qE.slice(0, t * rData.stride) },
      ], { reference: rData.exactEnergy, yLabel: 'energy' });
      
      drawTraces($('chart-conv'), [
        { name: 'Metropolis', color: '#F08A73', ys: cumulativeMean(rData.mE.slice(0, t * rData.stride)) },
        { name: 'QeMCMC', color: '#62B6CF', ys: cumulativeMean(rData.qE.slice(0, t * rData.stride)) },
      ], { reference: rData.exactEnergy, yLabel: 'cumulative mean energy' });
    }, 60);
    this.updateCharts();
  }

  async runLive() {
    this.currentAdapter.cancel();
    if (this.replayTimer) clearInterval(this.replayTimer);
    
    $('btn-live').disabled = true;
    const steps = +$('input-steps').value || 400;
    
    try {
      const results = await this.currentAdapter.run({ steps }, (done, total, out) => {
        if (out) {
          const net = this.vizInstances.get('network');
          if (net) net.setStates(out.states);
          drawTraces($('chart-trace'), out.traces, { reference: out.exactEnergy, yLabel: 'energy' });
          drawTraces($('chart-conv'), out.convergence, { reference: out.exactEnergy, yLabel: 'cumulative mean energy' });
        }
        status(`Running live computation: step ${done}/${total}...`);
      });
      status(`Computation complete.`);
      this.updateCharts(results);
      this.renderSolution(results);
    } catch (err) {
      if (err.message !== 'cancelled') status(`Error: ${err.message}`);
    } finally {
      $('btn-live').disabled = false;
    }
  }

  updateCharts(resultsOverride = null) {
    const res = resultsOverride || this.currentAdapter.getResults();
    const { stats, ranking } = res;
    
    // Stats
    if ($('sampler-stats')) {
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

    if ($('chart-ranking')) {
      drawRanking($('chart-ranking'), ranking);
    }

    if ($('chart-trace')) {
      const rData = this.currentAdapter.getReplayData();
      if (rData) {
        drawTraces($('chart-trace'), [
          { name: 'Metropolis', color: '#F08A73', ys: rData.mE },
          { name: 'QeMCMC', color: '#62B6CF', ys: rData.qE },
        ], { reference: rData.exactEnergy, yLabel: 'energy' });
        
        drawTraces($('chart-conv'), [
          { name: 'Metropolis', color: '#F08A73', ys: cumulativeMean(rData.mE) },
          { name: 'QeMCMC', color: '#62B6CF', ys: cumulativeMean(rData.qE) },
        ], { reference: rData.exactEnergy, yLabel: 'cumulative mean energy' });
      }
    }
    
    if ($('chart-regret')) {
      const bcfg = this.currentAdapter.getBailoutConfig();
      drawRegret($('chart-regret'), {
        table: this.currentAdapter.data.bailout.table,
        optimal: bcfg.optimal,
        budget: bcfg.budget
      });
    }
  }
}

// Boot application
window.addEventListener('DOMContentLoaded', () => {
  new App();
});
