// Bailout policy lab: pick up to K banks (buttons or 3D clicks), score the
// intervention by exact re-enumeration through the Python engine, and show
// regret against the true optimum for that budget.

import { topK } from './stats.js';

export class BailoutPanel {
  constructor({ n, tiers, omega, budget, optimal, strategies, evaluate, onSelection }) {
    this.n = n;
    this.omega = omega;
    this.budget = budget;
    this.optimal = optimal;
    this.strategies = strategies;
    this.evaluate = evaluate; // async (nodes:number[]) => m
    this.onSelection = onSelection;
    this.selected = new Set();

    this.kSelect = document.getElementById('bailout-k');
    this.result = document.getElementById('bailout-result');
    this.picker = document.getElementById('bank-picker');

    for (let i = 0; i < n; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `B${i} · ${tiers[i]}`;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => this.toggle(i));
      this.picker.appendChild(b);
    }
    document.getElementById('bailout-clear').addEventListener('click', () => {
      this.selected.clear();
      this._refresh();
    });
    this.kSelect.addEventListener('change', () => this._enforceBudget());
    for (const btn of document.querySelectorAll('.preset')) {
      btn.addEventListener('click', () => {
        const k = +this.kSelect.value;
        const scores = this.strategies[btn.dataset.strategy];
        this.selected = new Set(topK(scores, k));
        this._refresh();
      });
    }
  }

  get k() { return +this.kSelect.value; }

  toggle(i) {
    if (this.selected.has(i)) this.selected.delete(i);
    else this.selected.add(i);
    this._enforceBudget();
  }

  _enforceBudget() {
    while (this.selected.size > this.k) {
      this.selected.delete(this.selected.values().next().value);
    }
    this._refresh();
  }

  async _refresh() {
    const nodes = [...this.selected].sort((a, b) => a - b);
    for (const [i, b] of [...this.picker.children].entries()) {
      const on = this.selected.has(i);
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', String(on));
    }
    this.onSelection(nodes);
    if (!nodes.length) {
      this.result.textContent = 'Select banks to rescue, or apply a strategy preset.';
      return;
    }
    this.result.textContent = 'Scoring intervention...';
    try {
      const m = await this.evaluate(nodes);
      const opt = this.optimal[String(Math.max(1, this.k))];
      const regret = Math.max(0, opt.m - m);
      const cls = regret < 0.01 ? 'good' : 'bad';
      this.result.innerHTML =
        `m(S) = <b>${m.toFixed(3)}</b> under bailout {${nodes.map((i) => 'B' + i).join(', ')}}; ` +
        `optimal at K=${this.k} is ${opt.m.toFixed(3)} {${opt.set.map((i) => 'B' + i).join(', ')}}; ` +
        `regret <span class="${cls}">${regret.toFixed(3)}</span>`;
    } catch (err) {
      this.result.textContent = 'Scoring failed: ' + err;
    }
  }
}
