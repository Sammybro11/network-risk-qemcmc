// Three.js interbank network: banks as spheres on tier rings, edges weighted
// by dependency A. Nodes lerp green -> red as defaults spread during replay
// or live runs, and can be click-selected for the bailout lab.

import * as THREE from 'three';

const TIER_RADIUS = { core: 0.0, intermediate: 3.2, periphery: 6.0 };
const TIER_COLOR = { core: 0xf2a33c, intermediate: 0x4cc2ff, periphery: 0x8b93a7 };
const HEALTHY = new THREE.Color(0x39d98a);
const FAILED = new THREE.Color(0xff4d5e);

export class NetworkViz {
  constructor(container, { A, tiers }) {
    this.A = A;
    this.tiers = tiers;
    this.n = tiers.length;
    this.selected = new Set();
    this.onNodeClick = null;
    this._failed = new Array(this.n).fill(false);
    this._pulse = new Array(this.n).fill(0);

    const w = container.clientWidth, hgt = container.clientHeight;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, w / hgt, 0.1, 100);
    this.camera.position.set(0, 9, 11);
    this.camera.lookAt(0, 0, 0);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(w, hgt);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(5, 10, 7);
    this.scene.add(key);

    this.nodes = [];
    const geo = new THREE.SphereGeometry(0.32, 24, 24);
    const ringCount = { core: 0, intermediate: 0, periphery: 0 };
    for (let i = 0; i < this.n; i++) {
      const tier = tiers[i];
      const idx = ringCount[tier]++;
      const perRing = tiers.filter((t) => t === tier).length;
      const r = TIER_RADIUS[tier];
      const angle = (2 * Math.PI * idx) / perRing + (tier === 'periphery' ? 0.4 : 0);
      const jitter = ((i * 2654435761) % 100) / 100 - 0.5;
      const mat = new THREE.MeshStandardMaterial({
        color: TIER_COLOR[tier],
        emissive: HEALTHY,
        emissiveIntensity: 0.25,
        roughness: 0.4,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        (r + jitter) * Math.cos(angle),
        tier === 'core' ? 0.3 * idx : 0.6 * jitter,
        (r + jitter) * Math.sin(angle)
      );
      mesh.userData.bank = i;
      this.scene.add(mesh);
      this.nodes.push(mesh);
    }

    const positions = [];
    const maxA = Math.max(...this.A.flat());
    for (let i = 0; i < this.n; i++)
      for (let j = 0; j < this.n; j++) {
        if (i === j || this.A[i][j] < 0.02 * maxA) continue;
        positions.push(
          this.nodes[i].position.x, this.nodes[i].position.y, this.nodes[i].position.z,
          this.nodes[j].position.x, this.nodes[j].position.y, this.nodes[j].position.z
        );
      }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.scene.add(new THREE.LineSegments(
      lineGeo,
      new THREE.LineBasicMaterial({ color: 0x3a4460, transparent: true, opacity: 0.55 })
    ));

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.renderer.domElement.addEventListener('pointerdown', (ev) => this._pick(ev));

    this._reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._t = 0;
    this._animate = this._animate.bind(this);
    this.renderer.setAnimationLoop(this._animate);

    new ResizeObserver(() => {
      const w2 = container.clientWidth, h2 = container.clientHeight;
      this.camera.aspect = w2 / h2;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w2, h2);
    }).observe(container);
  }

  _pick(ev) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.nodes)[0];
    if (hit && this.onNodeClick) this.onNodeClick(hit.object.userData.bank);
  }

  // z_i = +1 healthy, -1 defaulted
  setStates(z) {
    for (let i = 0; i < this.n; i++) {
      const failed = z[i] < 0;
      if (failed && !this._failed[i]) this._pulse[i] = 1;
      this._failed[i] = failed;
    }
  }

  setSelected(set) {
    this.selected = new Set(set);
    this._applyColors();
  }

  _applyColors() {
    const c = new THREE.Color();
    for (let i = 0; i < this.n; i++) {
      const mat = this.nodes[i].material;
      c.copy(this._failed[i] ? FAILED : HEALTHY);
      mat.emissive.copy(c);
      mat.emissiveIntensity = this.selected.has(i) ? 1.0 : 0.25 + 0.5 * this._pulse[i];
    }
  }

  _animate() {
    this._t += 0.004;
    if (!this._reduced) this.scene.rotation.y = this._t;
    for (let i = 0; i < this.n; i++) {
      this._pulse[i] = Math.max(0, this._pulse[i] - 0.02);
      const s = 1 + 0.5 * this._pulse[i] + (this.selected.has(i) ? 0.15 : 0);
      this.nodes[i].scale.setScalar(s);
    }
    this._applyColors();
    this.renderer.render(this.scene, this.camera);
  }
}
