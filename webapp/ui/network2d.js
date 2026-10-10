// 2D interbank network on canvas: concentric tier rings (core innermost,
// periphery outermost), dependency edges weighted by A. Failure colors the
// node red and emits an expanding pulse; nodes are click-pickable for the
// bailout lab, and selected nodes get a bright outline.

const TIER_COLOR = { core: '#f2a33c', intermediate: '#4cc2ff', periphery: '#8b93a7' };
const RING_RADIUS = [0.22, 0.55, 1.0];
const HEALTHY = [0x39, 0xd9, 0x8a];
const FAILED = '#ff4d5e';

const tierRing = (tier) => ['core', 'intermediate', 'periphery'].indexOf(tier);
const hsvLerp = (tier) => {
  const hex = TIER_COLOR[tier];
  const b = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  return HEALTHY.map((v, i) => Math.round(v + (b[i] - v) * 0.6)).join(',');
};

export class Network2D {
  constructor(canvas, { A, tiers }) {
    this.canvas = canvas;
    this.tiers = tiers;
    this.n = tiers.length;
    this.ctx = canvas.getContext('2d');
    this.selected = new Set();
    this.onNodeClick = null;
    this._failed = new Array(this.n).fill(false);
    this._pulse = new Array(this.n).fill(0);

    const byRing = [[], [], []];
    for (let i = 0; i < this.n; i++) byRing[tierRing(tiers[i])].push(i);
    this._nodeAt = byRing.flatMap((members, t) =>
      members.map((bank, idx) => {
        const angle = (2 * Math.PI * idx) / members.length + (t === 2 ? 0.4 : 0);
        const jitter = ((((bank * 2654435761) % 100) / 100 - 0.5) * (t ? 0.1 : 0.35)) + 1;
        return { bank, tier: t, angle, R: RING_RADIUS[t] * jitter };
      })
    );

    const maxA = Math.max(...A.flat(), 1e-9);
    this._edges = [];
    for (let i = 0; i < this.n; i++)
      for (let j = 0; j < this.n; j++) {
        if (i !== j && A[i][j] > 0.02 * maxA)
          this._edges.push({ i, j, w: A[i][j] / maxA });
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
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const R = Math.min(W, H) / 2 - 22;
    const cx = W / 2, cy = H / 2;
    const xy = this._nodeAt.map(({ angle, R: rr }) => [
      cx + R * rr * Math.cos(angle),
      cy + R * rr * Math.sin(angle),
    ]);
    return { W, H, cx, cy, R, xy };
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
    const { cx, cy, R, xy } = this._geometry();

    for (let t = 0; t < 3; t++) {
      ctx.strokeStyle = '#232b3d';
      ctx.beginPath();
      ctx.arc(cx, cy, R * RING_RADIUS[t], 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.fillStyle = '#8b93a7';
    ctx.font = '10px system-ui, sans-serif';
    for (const [t, label] of [[0, 'core'], [1, 'intermediate'], [2, 'periphery']]) {
      ctx.fillText(label, cx + 4, cy - R * RING_RADIUS[t] - 5);
    }

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
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 5 + (1 - this._pulse[k]) * 16, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.globalAlpha = 1;
        this._pulse[k] = Math.max(0, this._pulse[k] - 0.03);
      }
      const color = failed ? FAILED : `rgb(${hsvLerp(this.tiers[node.bank])})`;
      const r = (failed ? 9 : 7.5) * (1 + 0.15 * (2 - node.tier));
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fill();
      if (this.selected.has(node.bank)) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 3.5, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.fillStyle = '#0d1117';
      ctx.font = 'bold 9px system-ui, sans-serif';
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
