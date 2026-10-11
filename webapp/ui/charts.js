// Minimal canvas-2D charts (no dependencies): line traces with an exact
// reference line, and per-bank ranking bars.

const COLORS = {
  quantum: '#62B6CF',
  metro: '#F08A73',
  exact: '#C3CBD1',
  grid: '#4A545C',
  text: '#D6DBDE',
  healthy: '#4A5D6E',
  failed: '#B9362D',
  strength: '#8CA0AF',
  eigenvector: '#7B8FA0',
  debtrank: '#6E8394',
  'quantum-chi': '#62B6CF',
  'metro-chi': '#F08A73',
};

// Resize the backing store ONLY when it actually changes. Assigning
// canvas.width/height unconditionally on every draw rewrites the element's
// intrinsic size, which perturbs flex layout, which wakes the ResizeObserver,
// which redraws -- a loop that makes the whole page creep and jitter. It only
// shows up on some machines because it depends on devicePixelRatio, scrollbar
// width and font metrics.
function setup(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight || +canvas.getAttribute('height');
  const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
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

// Text drawn over the data. Labels painted before the series get overpainted
// by the magnetization trace, which fills the whole plot area, so every
// annotation goes on last with an opaque plate behind it.
function plate(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(23, 27, 32, 0.85)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = COLORS.text;
}

export function drawTraces(canvas, series, { reference, yLabel = '', refLabel = 'exact' }) {
  // series: [{ name, color, ys }] plotted against step index. A NaN entry is
  // a deliberate gap (chain boundary), not data: it breaks the stroke so four
  // concatenated chains do not read as one continuous walk.
  const { ctx, w, h } = setup(canvas);
  const pad = { l: 52, r: 12, t: 10, b: 26 };
  const all = series.flatMap((s) => s.ys).filter(Number.isFinite);
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

  // Data first; every annotation that shares its pixels goes on top.
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.globalAlpha = s.alpha ?? 1;
    ctx.lineWidth = s.width ?? 1.6;
    ctx.beginPath();
    let pen = false;
    s.ys.forEach((v, i) => {
      if (!Number.isFinite(v)) { pen = false; return; }
      if (pen) ctx.lineTo(X(i, s.ys.length), Y(v));
      else ctx.moveTo(X(i, s.ys.length), Y(v));
      pen = true;
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (reference !== undefined) {
    ctx.strokeStyle = COLORS.exact;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.l, Y(reference));
    ctx.lineTo(w - pad.r, Y(reference));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    const tw = ctx.measureText(refLabel).width;
    plate(ctx, w - pad.r - tw - 8, Y(reference) - 15, tw + 8, 14);
    ctx.fillText(refLabel, w - pad.r - 2, Y(reference) - 4);
  }

  if (yLabel) {
    ctx.textAlign = 'left';
    const tw = ctx.measureText(yLabel).width;
    plate(ctx, pad.l + 2, pad.t, tw + 8, 16);
    ctx.fillText(yLabel, pad.l + 4, pad.t + 10);
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
  // Grouped vertical bars per bank: exact mu vs each strategy, sorted by
  // exact mu so the ranking story reads left to right. Values on the y
  // axis with faint gridlines; labels rotate when groups get tight.
  const { ctx, w, h } = setup(canvas);
  ctx.clearRect(0, 0, w, h);
  const n = muExact.length;
  const entries = Object.entries({ exact: muExact, ...arms, ...strategies });
  const order = muExact.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  const maxV = Math.max(...entries.flatMap(([, v]) => v.map(Math.abs)), 1e-9);
  // Sits under the mechanism panel, spanning the full grid width. Left pad
  // now holds y-axis tick labels; bottom pad holds the rotated node labels.
  const pad = { l: 46, r: 16, t: 18, b: 40 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const groupW = plotW / n;
  const barW = Math.min(14, (groupW - 6) / entries.length);

  // Faint horizontal gridlines + y ticks at quarters of the max value.
  ctx.font = '9px "IBM Plex Mono", monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let f = 0; f <= 4; f++) {
    const v = (maxV * f) / 4;
    const y = pad.t + plotH - (f / 4) * plotH;
    ctx.strokeStyle = f === 0 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + plotW, y);
    ctx.stroke();
    ctx.fillStyle = COLORS.muted || 'rgba(255,255,255,0.5)';
    ctx.fillText(v.toFixed(2), pad.l - 6, y);
  }
  ctx.textBaseline = 'alphabetic';

  order.forEach((bank, col) => {
    const x0 = pad.l + col * groupW;
    const center = x0 + groupW / 2;
    entries.forEach(([name, vals], k) => {
      const v = vals[bank] / maxV;
      const bh = Math.max(1, v * plotH);
      const x = center - (entries.length * barW) / 2 + k * barW;
      ctx.fillStyle = COLORS[name] || COLORS.exact;
      ctx.fillRect(x, pad.t + plotH - bh, barW - 1, bh);
    });

    // Node label under its group; rotate when the group is narrower than
    // the text so adjacent labels never collide (up to 16 banks in finance).
    const label = `B${bank} ${tiers[bank]}`;
    ctx.fillStyle = COLORS.text;
    if (groupW < ctx.measureText(label).width + 4) {
      ctx.save();
      ctx.translate(center + 4, pad.t + plotH + 6);
      ctx.rotate(-Math.PI / 3);
      ctx.textAlign = 'right';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    } else {
      ctx.textAlign = 'center';
      ctx.fillText(label, center, pad.t + plotH + 14);
    }
  });

  ctx.textAlign = 'left';
  let lx = pad.l;
  for (const [name] of entries) {
    // Swatch in the series colour, text always light: the baseline colours are
    // dark slate by design and unreadable as text on the panel background.
    ctx.fillStyle = COLORS[name] || COLORS.exact;
    ctx.fillRect(lx, h - 14, 8, 3);
    ctx.fillStyle = COLORS.text;
    ctx.fillText(name, lx + 12, h - 8);
    lx += 12 + ctx.measureText(name).width + 16;
  }
}
