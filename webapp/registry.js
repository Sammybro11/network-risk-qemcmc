import { FinanceAdapter } from './adapters/finance.js';
import { MaxCutAdapter } from './adapters/maxcut.js';

export const Registry = {
  adapters: new Map(),

  register(adapterClass) {
    const adapter = new adapterClass();
    this.adapters.set(adapter.id, adapter);
  },

  get(id) {
    return this.adapters.get(id);
  },

  getAll() {
    return Array.from(this.adapters.values());
  }
};

// Register existing modules
Registry.register(FinanceAdapter);
Registry.register(MaxCutAdapter);
