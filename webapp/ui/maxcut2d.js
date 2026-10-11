// Dedicated 2D Graph Bipartition Canvas Visualizer for Max-Cut Optimization

const COLOR_SET_A = '#62B6CF'; // Cyan for Set A (+1)
const COLOR_SET_B = '#F08A73'; // Coral/Amber for Set B (-1)
const COLOR_CUT_EDGE = '#48C774'; // Bright emerald green for crossing cut edges
const COLOR_UNCUT_EDGE = 'rgba(74, 93, 110, 0.25)'; // Faint grey/slate for same-set edges

export class MaxCut2D {
  constructor(canvas, { n, edges, state, onNodeClick }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.n = n;
    this.edges = edges; // Array of [u, v]
    this.state = state ? [...state] : Array(n).fill(1); // 1 = Set A, -1 = Set B
    this.onNodeClick = onNodeClick || null;
    this.hoverNode = -1;

    canvas.addEventListener('click', (e) => this._handleClick(e));
    canvas.addEventListener('mousemove', (e) => this._handleMouseMove(e));
    canvas.addEventListener('mouseleave', () => { this.hoverNode = -1; this._draw(); });

    this._draw();
  }

  setState(state) {
    this.state = [...state];
    this._draw();
  }

  setGraph(n, edges, state) {
    this.n = n;
    this.edges = edges;
    if (state) this.state = [...state];
    this._draw();
  }

  _computePositions(W, H) {
    // Partition nodes into Set A (left side) and Set B (right side)
    const cxA = W * 0.32, cyA = H * 0.5;
    const cxB = W * 0.68, cyB = H * 0.5;
    const clusterR = Math.max(30, Math.min(W * 0.22, H * 0.35));

    const setA = [], setB = [];
    for (let i = 0; i < this.n; i++) {
      if (this.state[i] >= 0) setA.push(i);
      else setB.push(i);
    }

    const pos = new Array(this.n);
    setA.forEach((node, idx) => {
      const angle = (idx / Math.max(1, setA.length)) * 2 * Math.PI - Math.PI / 2;
      pos[node] = [cxA + clusterR * Math.cos(angle), cyA + clusterR * Math.sin(angle)];
    });
    setB.forEach((node, idx) => {
      const angle = (idx / Math.max(1, setB.length)) * 2 * Math.PI - Math.PI / 2;
      pos[node] = [cxB + clusterR * Math.cos(angle), cyB + clusterR * Math.sin(angle)];
    });

    return { pos, cxA, cyA, cxB, cyB, clusterR };
  }

  _draw() {
    const { canvas, ctx } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(10, canvas.clientWidth || 400);
    const H = Math.max(10, canvas.clientHeight || 300);

    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const { pos, cxA, cyA, cxB, cyB, clusterR } = this._computePositions(W, H);

    // Cluster boundary halos
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(98, 182, 207, 0.25)';
    ctx.beginPath();
    ctx.arc(cxA, cyA, clusterR + 24, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(240, 138, 115, 0.25)';
    ctx.beginPath();
    ctx.arc(cxB, cyB, clusterR + 24, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);

    // Cluster labels
    ctx.font = '11px "Inter", sans-serif';
    ctx.fillStyle = COLOR_SET_A;
    ctx.textAlign = 'center';
    ctx.fillText('SET A (+1)', cxA, cyA - clusterR - 32);

    ctx.fillStyle = COLOR_SET_B;
    ctx.fillText('SET B (−1)', cxB, cyB - clusterR - 32);

    // Draw edges
    let cutCount = 0;
    for (const [u, v] of this.edges) {
      if (u >= this.n || v >= this.n) continue;
      const [x1, y1] = pos[u];
      const [x2, y2] = pos[v];
      const isCut = this.state[u] !== this.state[v];

      if (isCut) {
        cutCount++;
        ctx.strokeStyle = COLOR_CUT_EDGE;
        ctx.lineWidth = 2.2;
        ctx.globalAlpha = 0.85;
      } else {
        ctx.strokeStyle = COLOR_UNCUT_EDGE;
        ctx.lineWidth = 1.0;
        ctx.globalAlpha = 0.4;
      }

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1.0;

    // Draw nodes
    for (let i = 0; i < this.n; i++) {
      const [x, y] = pos[i];
      const inSetA = this.state[i] >= 0;
      const isHover = this.hoverNode === i;
      const r = isHover ? 13 : 11;

      // Glow on hover
      if (isHover) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, 2 * Math.PI);
        ctx.stroke();
      }

      ctx.fillStyle = inSetA ? COLOR_SET_A : COLOR_SET_B;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fill();

      // Node label
      ctx.fillStyle = '#171B20';
      ctx.font = 'bold 10px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(i), x, y + 3.5);
    }

    // Cut score summary badge on canvas
    const cutRatio = this.edges.length > 0 ? ((cutCount / this.edges.length) * 100).toFixed(1) : 0;
    ctx.fillStyle = 'rgba(23, 27, 32, 0.85)';
    ctx.fillRect(W - 165, H - 42, 155, 34);
    ctx.strokeStyle = COLOR_CUT_EDGE;
    ctx.lineWidth = 1;
    ctx.strokeRect(W - 165, H - 42, 155, 34);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`CUT: ${cutCount} / ${this.edges.length} (${cutRatio}%)`, W - 155, H - 20);
  }

  _getNodeAt(px, py) {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const { pos } = this._computePositions(W, H);
    for (let i = 0; i < this.n; i++) {
      const [x, y] = pos[i];
      const d2 = (x - px) ** 2 + (y - py) ** 2;
      if (d2 <= 16 * 16) return i;
    }
    return -1;
  }

  _handleClick(ev) {
    const rect = this.canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    const node = this._getNodeAt(px, py);
    if (node >= 0) {
      this.state[node] *= -1; // Toggle node partition
      this._draw();
      if (this.onNodeClick) this.onNodeClick(node, this.state);
    }
  }

  _handleMouseMove(ev) {
    const rect = this.canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    const node = this._getNodeAt(px, py);
    if (this.hoverNode !== node) {
      this.hoverNode = node;
      this.canvas.style.cursor = node >= 0 ? 'pointer' : 'default';
      this._draw();
    }
  }
}
