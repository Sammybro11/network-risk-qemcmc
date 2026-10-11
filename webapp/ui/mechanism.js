// Mechanism panels: WHY the two samplers differ, straight from the recorded
// histograms in the scenario digest.
//
//   flip-size histogram  -- distribution of Hamming distance per ACCEPTED move.
//     Single-spin Metropolis can only ever score 0 or 1; the Trotterised
//     proposal returns a whole configuration, so it flips regions at a time.
//     This is the mechanism behind every other number on the page.
//
//   basin occupancy      -- where each chain actually spent its time, as a
//     histogram of chain magnetization, against the exact thermal mean. A
//     frozen chain piles up in one basin and never sees the other, which is
//     what collapses its covariance estimate.

const COLORS = {
  quantum: '#62B6CF',
  metro: '#F08A73',
  exact: '#A8B0B5',
  grid: '#363D43',
  text: '#A8B0B5',
};

function setup(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight || +canvas.getAttribute('height');
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function frame(ctx, w, h, pad) {
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, h - pad.b);
  ctx.lineTo(w - pad.r, h - pad.b);
  ctx.stroke();
}

function legend(ctx, w, h, entries) {
  ctx.textAlign = 'left';
  ctx.font = '10px "IBM Plex Mono", monospace';
  let lx = 46;
  for (const [name, color] of entries) {
    ctx.fillStyle = color;
    ctx.fillRect(lx, h - 11, 8, 3);
    ctx.fillText(name, lx + 12, h - 7);
    lx += 12 + ctx.measureText(name).width + 16;
  }
}

// Shares rather than raw counts: the two arms ran the same number of steps but
// accept at very different rates, so counts would compare acceptance, not move
// size. Bin 0 (rejected / no-op proposals) is dropped for the same reason.
function shares(hist) {
  const tail = hist.slice(1);
  const total = tail.reduce((a, b) => a + b, 0) || 1;
  return tail.map((c) => c / total);
}

export function drawFlipHist(canvas, { metro, quantum }) {
  const { ctx, w, h } = setup(canvas);
  const pad = { l: 40, r: 10, t: 16, b: 30 };
  const sm = shares(metro), sq = shares(quantum);
  const n = Math.max(sm.length, sq.length);
  const maxV = Math.max(...sm, ...sq, 1e-9);
  const bandW = (w - pad.l - pad.r) / n;
  const barW = Math.min(9, (bandW - 2) / 2);

  frame(ctx, w, h, pad);
  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'right';
  ctx.fillText(`${(maxV * 100).toFixed(0)}%`, pad.l - 5, pad.t + 8);
  ctx.textAlign = 'left';
  ctx.fillText('share of accepted moves', pad.l + 4, pad.t + 8);

  for (let k = 0; k < n; k++) {
    const x0 = pad.l + k * bandW + (bandW - 2 * barW) / 2;
    [[sm[k] || 0, COLORS.metro, 0], [sq[k] || 0, COLORS.quantum, 1]].forEach(([v, color, slot]) => {
      const bh = (v / maxV) * (h - pad.t - pad.b);
      ctx.fillStyle = color;
      ctx.fillRect(x0 + slot * barW, h - pad.b - bh, barW - 1, bh);
    });
    if (n <= 16 || k % 2 === 0) {
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'center';
      ctx.fillText(String(k + 1), pad.l + k * bandW + bandW / 2, h - pad.b + 12);
    }
  }
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'center';
  ctx.fillText('spins flipped per accepted move', (pad.l + w - pad.r) / 2, h - pad.b + 24);
  legend(ctx, w, h, [['Metropolis', COLORS.metro], ['QeMCMC', COLORS.quantum]]);
}

export function drawBasinHist(canvas, { metro, quantum, exactM, loLabel = 'all failed', hiLabel = 'all healthy' }) {
  const { ctx, w, h } = setup(canvas);
  const pad = { l: 40, r: 10, t: 16, b: 30 };
  const n = metro.length;
  const norm = (hist) => {
    const total = hist.reduce((a, b) => a + b, 0) || 1;
    return hist.map((c) => c / total);
  };
  const sm = norm(metro), sq = norm(quantum);
  const maxV = Math.max(...sm, ...sq, 1e-9);
  const bandW = (w - pad.l - pad.r) / n;
  const barW = Math.min(9, (bandW - 2) / 2);
  // Bin centres run from m = -1 (all failed) to m = +1 (all healthy).
  const X = (m) => pad.l + ((m + 1) / 2) * (w - pad.l - pad.r);

  frame(ctx, w, h, pad);
  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'right';
  ctx.fillText(`${(maxV * 100).toFixed(0)}%`, pad.l - 5, pad.t + 8);
  ctx.textAlign = 'left';
  ctx.fillText('time spent', pad.l + 4, pad.t + 8);

  for (let k = 0; k < n; k++) {
    const x0 = pad.l + k * bandW + (bandW - 2 * barW) / 2;
    [[sm[k], COLORS.metro, 0], [sq[k], COLORS.quantum, 1]].forEach(([v, color, slot]) => {
      const bh = (v / maxV) * (h - pad.t - pad.b);
      ctx.fillStyle = color;
      ctx.fillRect(x0 + slot * barW, h - pad.b - bh, barW - 1, bh);
    });
  }

  if (exactM !== undefined) {
    const x = X(exactM);
    ctx.strokeStyle = COLORS.exact;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, pad.t);
    ctx.lineTo(x, h - pad.b);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.exact;
    ctx.textAlign = 'center';
    ctx.fillText(`exact m = ${exactM.toFixed(2)}`, x, pad.t - 4);
  }

  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'left';
  ctx.fillText(loLabel, pad.l, h - pad.b + 12);
  ctx.textAlign = 'right';
  ctx.fillText(hiLabel, w - pad.r, h - pad.b + 12);
  ctx.textAlign = 'center';
  ctx.fillText('chain magnetization m', (pad.l + w - pad.r) / 2, h - pad.b + 24);
  legend(ctx, w, h, [['Metropolis', COLORS.metro], ['QeMCMC', COLORS.quantum]]);
}
