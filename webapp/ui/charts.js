// Minimal canvas-2D charts (no dependencies): line traces with an exact
// reference line, per-bank ranking bars, and grouped bailout-regret bars.

const COLORS = {
  quantum: '#62B6CF',
  metro: '#F08A73',
  exact: '#A8B0B5',
  grid: '#363D43',
  text: '#A8B0B5',
  healthy: '#4A5D6E',
  failed: '#B9362D',
  strength: '#6A7B89',
  eigenvector: '#5A6B79',
  debtrank: '#4A5D6E',
  'random-mean': '#3A4B59',
  'quantum-chi': '#62B6CF',
  'metro-chi': '#F08A73',
};

function setup(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight || +canvas.getAttribute('height');
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, w, h };
}

function axes(ctx, w, h, pad) {
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, h - pad.b);
  ctx.lineTo(w - pad.r, h - pad.b);
  ctx.stroke();
}

export function drawTraces(canvas, series, { reference, yLabel = '' }) {
  // series: [{ name, color, ys }] plotted against step index.
  const { ctx, w, h } = setup(canvas);
  const pad = { l: 52, r: 12, t: 10, b: 26 };
  const all = series.flatMap((s) => s.ys);
  if (reference !== undefined) all.push(reference);
  if (!all.length) return;
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const X = (i, len) => pad.l + ((w - pad.l - pad.r) * i) / Math.max(1, len - 1);
  const Y = (v) => h - pad.b - ((h - pad.t - pad.b) * (v - lo)) / (hi - lo);

  ctx.clearRect(0, 0, w, h);
  axes(ctx, w, h, pad);
  ctx.fillStyle = COLORS.text;
  ctx.font = '11px "IBM Plex Mono", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(hi.toFixed(1), pad.l - 6, Y(hi) + 4);
  ctx.fillText(lo.toFixed(1), pad.l - 6, Y(lo) + 4);
  if (yLabel) { ctx.textAlign = 'left'; ctx.fillText(yLabel, pad.l + 4, pad.t + 10); }

  if (reference !== undefined) {
    ctx.strokeStyle = COLORS.exact;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.l, Y(reference));
    ctx.lineTo(w - pad.r, Y(reference));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.exact;
    ctx.textAlign = 'right';
    ctx.fillText('exact', w - pad.r - 2, Y(reference) - 4);
  }

  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    s.ys.forEach((v, i) => (i ? ctx.lineTo(X(i, s.ys.length), Y(v)) : ctx.moveTo(X(0, s.ys.length), Y(v))));
    ctx.stroke();
  }

  ctx.textAlign = 'left';
  let lx = pad.l + 6;
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, h - 18, 10, 3);
    ctx.fillText(s.name, lx + 14, h - 12);
    lx += 14 + ctx.measureText(s.name).width + 22;
  }
}

export function drawRanking(canvas, { muExact, arms, strategies, tiers }) {
  // Grouped horizontal bars per bank: exact mu vs each strategy, sorted by
  // exact mu so the ranking story reads left to right.
  const { ctx, w, h } = setup(canvas);
  ctx.clearRect(0, 0, w, h);
  const n = muExact.length;
  const entries = Object.entries({ exact: muExact, ...arms, ...strategies });
  const order = muExact.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  const maxV = Math.max(...entries.flatMap(([, v]) => v.map(Math.abs)), 1e-9);
  const pad = { l: 74, r: 12, t: 18, b: 26 };
  const bandH = (h - pad.t - pad.b) / n;
  const barH = Math.min(5, (bandH - 3) / entries.length);

  ctx.font = '10px "IBM Plex Mono", monospace';
  order.forEach((bank, row) => {
    const y0 = pad.t + row * bandH;
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'right';
    ctx.fillText(`B${bank} ${tiers[bank]}`, pad.l - 6, y0 + bandH / 2 + 3);
    entries.forEach(([name, vals], k) => {
      const v = vals[bank] / maxV;
      const bw = v * (w - pad.l - pad.r) * 0.5;
      const y = y0 + 2 + k * barH;
      ctx.fillStyle = COLORS[name] || COLORS.exact;
      ctx.fillRect(pad.l, y, Math.max(1, bw), barH - 1);
    });
  });

  ctx.textAlign = 'left';
  let lx = pad.l;
  for (const [name] of entries) {
    ctx.fillStyle = COLORS[name] || COLORS.exact;
    ctx.fillRect(lx, h - 14, 8, 3);
    ctx.fillText(name, lx + 12, h - 8);
    lx += 12 + ctx.measureText(name).width + 16;
  }
}

export function drawRegret(canvas, { table, optimal, budget }) {
  // Grouped bars: regret = m_opt - m(S) per strategy per budget K.
  const { ctx, w, h } = setup(canvas);
  ctx.clearRect(0, 0, w, h);
  const names = Object.keys(table);
  const Ks = Array.from({ length: budget }, (_, i) => String(i + 1));
  const regrets = names.map((name) =>
    Ks.map((k) => Math.max(0, optimal[k].m - table[name][k].m))
  );
  const maxR = Math.max(...regrets.flat(), 1e-9);
  const pad = { l: 44, r: 12, t: 12, b: 44 };
  const groupW = (w - pad.l - pad.r) / Ks.length;
  const barW = Math.min(16, (groupW - 14) / names.length);

  axes(ctx, w, h, pad);
  ctx.font = '10px "IBM Plex Mono", monospace';
  Ks.forEach((k, g) => {
    const x0 = pad.l + g * groupW + 7;
    names.forEach((name, i) => {
      const r = regrets[i][g] / maxR;
      const bh = r * (h - pad.t - pad.b);
      ctx.fillStyle = COLORS[name] || COLORS.exact;
      ctx.fillRect(x0 + i * barW, h - pad.b - bh, barW - 2, bh);
    });
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.fillText(`K=${k}`, pad.l + g * groupW + groupW / 2, h - pad.b + 14);
  });

  ctx.textAlign = 'left';
  let lx = pad.l;
  const ly = h - 14;
  for (const name of names) {
    ctx.fillStyle = COLORS[name] || COLORS.exact;
    ctx.fillRect(lx, ly, 8, 3);
    ctx.fillText(name, lx + 12, ly + 4);
    lx += 12 + ctx.measureText(name).width + 14;
  }
}
