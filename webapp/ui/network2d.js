// 2D network on canvas. Node coordinates come from the scenario payload
// (spring layout for the finance networks, the literal street grid for
// traffic), so the picture matches the one the Python gallery draws. Edges are
// weighted by the dependency/flow matrix A. Failure colors the node red and
// emits an expanding pulse; nodes are click-pickable for the intervention lab,
// and selected nodes get a bright outline.
//
// Node RADIUS encodes exact susceptibility rank when `importance` is supplied:
// during replay there are no recorded per-step states to animate (the digests
// carry traces and histograms, not 20k x 4 configurations), so the map shows
// the ground-truth answer the samplers are competing to recover. Live runs do
// have states and animate normally.

const HEALTHY = [74, 93, 110]; // #4A5D6E
const FAILED = '#B9362D';
const TIER_SHADE = ['#6A7D8E', '#5A6D7E', '#4A5D6E'];

export class Network2D {
  constructor(canvas, { A, tiers, positions, tierOrder, importance, seeds = [], mark = {} }) {
    this.canvas = canvas;
    this.tiers = tiers;
    this.n = tiers.length;
    this.ctx = canvas.getContext('2d');
    this.selected = new Set();
    this.onNodeClick = null;
    this.mark = mark;
    this.seeds = new Set(seeds);
    this._failed = new Array(this.n).fill(false);
    this._pulse = new Array(this.n).fill(0);

    this.tierOrder = tierOrder || [...new Set(tiers)];
    this._shade = (i) => {
      const t = Math.max(0, this.tierOrder.indexOf(tiers[i]));
      const hex = TIER_SHADE[Math.min(t, TIER_SHADE.length - 1)];
      const b = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
      return HEALTHY.map((v, k) => Math.round(v + (b[k] - v) * 0.6)).join(',');
    };

    // positions arrive normalised to the unit square; y is flipped so the
    // exported layout (y up) draws the same way on canvas (y down).
    this._nodeAt = positions.map(([x, y], i) => ({ bank: i, x, y: 1 - y }));

    if (importance && importance.length === this.n) {
      const lo = Math.min(...importance), hi = Math.max(...importance);
      const span = hi - lo || 1;
      this._weight = importance.map((v) => (v - lo) / span);
    } else {
      this._weight = new Array(this.n).fill(0.5);
    }

    const maxA = Math.max(...A.flat().map(Math.abs), 1e-9);
    this._edges = [];
    for (let i = 0; i < this.n; i++)
      for (let j = 0; j < this.n; j++) {
        if (i !== j && Math.abs(A[i][j]) > 0.02 * maxA)
          this._edges.push({ i, j, w: Math.abs(A[i][j]) / maxA });
      }

    canvas.addEventListener('pointerdown', (ev) => this._pick(ev));
    this._reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const loop = () => { this._draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  // z_i = +1 healthy, -1 defaulted
  setStates(z) {
    for (let k = 0; k < this.n; k++) {
      const failed = z[this._nodeAt[k].bank] < 0;
      if (failed && !this._failed[k] && !this._reduced) this._pulse[k] = 1;
      this._failed[k] = failed;
    }
  }

  setSelected(set) {
    this.selected = new Set(set);
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

    for (const { i, j, w } of this._edges) {
      ctx.strokeStyle = `rgba(110,135,195,${0.07 + 0.35 * w})`;
      ctx.lineWidth = 0.5 + 2 * w;
      ctx.beginPath();
      ctx.moveTo(xy[i][0], xy[i][1]);
      ctx.lineTo(xy[j][0], xy[j][1]);
      ctx.stroke();
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
      const color = failed ? FAILED : `rgb(${this._shade(node.bank)})`;
      const r = Math.max(1, (5.5 + 7 * this._weight[node.bank]) * (failed ? 1.15 : 1));
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fill();
      if (this.seeds.has(node.bank)) {
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
      if (this.selected.has(node.bank)) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 3.5, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.fillStyle = '#171B20';
      ctx.font = 'bold 9px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(node.bank, x, y + 3);
    }
  }

  _pick(ev) {
    const rect = this.canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    const { xy } = this._geometry();
    let best = -1, bestD = 18 * 18;
    xy.forEach(([x, y], k) => {
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d < bestD) { bestD = d; best = k; }
    });
    if (best >= 0 && this.onNodeClick) this.onNodeClick(this._nodeAt[best].bank);
  }
}
