import { ScenarioAdapter } from './adapters/scenario.js';

// Modules are the recorded showcase scenarios exported by
// experiments/export_webapp_scenarios.py. data/scenarios/index.json lists
// them; each entry is backed by one self-contained payload carrying the
// recorded run AND the instance (J, h, A), so every panel -- replay,
// exact re-enumeration, intervention lab -- works off the same file.

export const Registry = {
  adapters: new Map(),

  async load() {
    const index = await (await fetch('data/scenarios/index.json')).json();
    for (const entry of index) {
      this.adapters.set(entry.id, new ScenarioAdapter(entry));
    }
    return this.getAll();
  },

  get(id) {
    return this.adapters.get(id);
  },

  getAll() {
    return Array.from(this.adapters.values());
  }
};
