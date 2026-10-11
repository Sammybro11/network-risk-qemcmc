// 2D network on canvas. Node coordinates come from the scenario payload
// (spring layout for the finance networks, the literal street grid for
// traffic), so the picture matches the one the Python gallery draws.
//
// The encoding is built to show ONE thing: where structure-only centrality and
// the equilibrium answer disagree, because that disagreement is the entire
// claim. Structure-only baselines are cheap, scale to huge networks, and are
// what a practitioner would reach for first -- they are also wrong near a
// tipping point.
//
//   fill colour  = exact susceptibility mu   (what you should actually protect)
//   radius       = structural strength       (what centrality would tell you)
//   outline      = tier                      (3 dash patterns; shades were
//                                             indistinguishable at this size)
//   red          = failure and cascade seeds, and nothing else
//
// So a LARGE DARK node is structurally central but not worth protecting, and a
// SMALL BRIGHT node is the hidden amplifier. In s2 the truth-rank-12 node is
// strength-rank 4; in s1 the truth-rank-1 node is strength-rank 12.
//
// During replay there are no recorded per-step states to animate (the digests
// carry traces and histograms, not 20k x 4 configurations), so the map shows
// ground truth.

const FAILED = '#B9362D';
// Sequential ramp for mu: muted slate (ignorable) -> quantum cyan (protect).
const RAMP_LO = [72, 86, 97];    // #485661 -- still legible against the canvas
const RAMP_HI = [98, 182, 207];  // #62B6CF -- var(--quantum)
const EDGE_FERRO = [122, 139, 153];  // #7A8B99 -- var(--structural)
const EDGE_FRUSTRATED = '#F08A73';   // var(--metro)
const TIER_DASH = [[], [5, 2], [1, 3]]; // solid / dashed / dotted

export class Network2D {
  constructor(canvas, {
    A, J, tiers, positions, tierOrder, importance, structure,
    seeds = [], mark = {},
  }) {
    this.canvas = canvas;
    this.tiers = tiers;
    this.n = tiers.length;
    this.ctx = canvas.getContext('2d');
    this.mark = mark;
    this.seeds = new Set(seeds);
    this._failed = new Array(this.n).fill(false);
    this._pulse = new Array(this.n).fill(0);

    this.tierOrder = tierOrder || [...new Set(tiers)];
    this._tierIdx = (i) => Math.max(0, this.tierOrder.indexOf(tiers[i]));

    this._nodeAt = positions.map(([x, y], i) => ({ bank: i, x, y: 1 - y }));

    // Rank percentile, not min-max. Both quantities are heavy-tailed: one or
    // two nodes carry most of the mass, so a linear scale renders everything
    // else as the same dark dot and the picture says nothing. Rank also IS the
    // quantity under discussion -- every fidelity metric on this page is a
    // rank correlation.
    const byRank = (xs) => {
      if (!xs || xs.length !== this.n) return new Array(this.n).fill(0.5);
      const order = [...xs.keys()].sort((a, b) => xs[a] - xs[b]);
      const out = new Array(this.n);
      order.forEach((idx, pos) => { out[idx] = this.n > 1 ? pos / (this.n - 1) : 0.5; });
      return out;
    };
    this._truth = byRank(importance);     // -> fill
    this._structure = byRank(structure);  // -> radius

    // Edges come from the COUPLINGS, not the dependency matrix: the sign of
    // J_ij is the physics (J < 0 wants agreement, J > 0 is frustration), and
    // the frustrated edges are the whole point of the rival-alliance scenario.
    const W = J || A;
    const maxW = Math.max(...W.flat().map(Math.abs), 1e-9);
    this._edges = [];
    for (let i = 0; i < this.n; i++)
      for (let j = i + 1; j < this.n; j++) {
        const v = W[i][j];
        if (Math.abs(v) > 0.02 * maxW) {
          this._edges.push({ i, j, w: Math.abs(v) / maxW, frustrated: v > 0 });
        }
      }
    this.hasFrustration = this._edges.some((e) => e.frustrated);

    this._reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const loop = () => { this._draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  _geometry() {
    const W = Math.max(10, this.canvas.clientWidth || 300), H = Math.max(10, this.canvas.clientHeight || 300);
    const m = 30;
    const side = Math.max(10, Math.min(W, H) - 2 * m);
    const ox = (W - side) / 2, oy = (H - side) / 2;
    const xy = this._nodeAt.map(({ x, y }) => [ox + x * side, oy + y * side]);
    return { W, H, xy };
  }

  _draw() {
    const { canvas, ctx } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const { xy } = this._geometry();

    // Frustrated couplings are drawn last and dashed so a handful of them
    // (s3 has 6 of 65) cannot be lost under the ferromagnetic majority.
    const ordered = [...this._edges].sort((a, b) => a.frustrated - b.frustrated);
    for (const { i, j, w, frustrated } of ordered) {
      if (frustrated) {
        ctx.strokeStyle = EDGE_FRUSTRATED;
        ctx.globalAlpha = 0.5 + 0.5 * w;
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1 + 2 * w;
      } else {
        ctx.strokeStyle = `rgba(${EDGE_FERRO.join(',')},${0.18 + 0.5 * w})`;
        ctx.lineWidth = 0.5 + 2 * w;
      }
      ctx.beginPath();
      ctx.moveTo(xy[i][0], xy[i][1]);
      ctx.lineTo(xy[j][0], xy[j][1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    for (let k = 0; k < this.n; k++) {
      const node = this._nodeAt[k];
      const [x, y] = xy[k];
      const failed = this._failed[k];
      if (this._pulse[k] > 0 && !this._reduced) {
        ctx.strokeStyle = FAILED;
        ctx.globalAlpha = this._pulse[k] * 0.7;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0, 5 + (1 - this._pulse[k]) * 16), 0, 2 * Math.PI);
        ctx.stroke();
        ctx.globalAlpha = 1;
        this._pulse[k] = Math.max(0, this._pulse[k] - 0.03);
      }
      const i = node.bank;
      // radius = what structure says; fill = what equilibrium says.
      const r = Math.max(1, (5 + 8 * this._structure[i]) * (failed ? 1.15 : 1));
      ctx.fillStyle = failed ? FAILED : rampColor(this._truth[i]);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fill();

      // tier as an outline dash pattern: three fill shades at this node size
      // were indistinguishable, so the channel was wasted.
      ctx.strokeStyle = 'rgba(234,230,220,0.5)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash(TIER_DASH[Math.min(this._tierIdx(i), TIER_DASH.length - 1)]);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);

      if (this.seeds.has(i)) {
        ctx.strokeStyle = FAILED;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r + 4.5, 0, 2 * Math.PI);
        ctx.stroke();
      }
      const tag = this.mark[node.bank];
      if (tag) {
        ctx.fillStyle = '#62B6CF';
        ctx.font = 'bold 10px "IBM Plex Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(tag, x + r + 4, y - r);
      }
      // Label contrast has to follow the fill, which now spans dark slate to
      // bright cyan; a fixed dark label vanished on the low end of the ramp.
      ctx.fillStyle = (failed || this._truth[i] > 0.45) ? '#171B20' : '#C9D1D6';
      ctx.font = 'bold 9px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(i, x, y + 3);
    }
  }
}

// Two-stop sRGB ramp. Good enough for an ordinal read ("brighter = protect
// this one") and it stays inside the page's existing slate/cyan palette.
export function rampColor(t) {
  const u = Math.min(1, Math.max(0, t));
  const c = RAMP_LO.map((lo, k) => Math.round(lo + (RAMP_HI[k] - lo) * u));
  return `rgb(${c.join(',')})`;
}
