// Crumbs that fall off crunchy desserts when they are cut or scooped. Simple particles: gravity,
// a bounce on the plate, rolling friction, then they rest where they land.

import { groundAt } from './sim.js';

const MAX = 400;

export class Crumbs {
  constructor() {
    this.list = [];
    this.data = new Float32Array(MAX * 12);
  }

  clear() {
    this.list.length = 0;
  }

  spawn(pos, vel, size, color) {
    if (this.list.length >= MAX) this.list.shift();
    const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI;
    this.list.push({
      p: pos.slice(),
      v: vel.slice(),
      size,
      q: [Math.sin(b) * Math.cos(a) * 0.7, Math.cos(b) * 0.7, Math.sin(b) * Math.sin(a) * 0.7, 0.714],
      w: [(Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14],
      color,
      rest: false,
    });
  }

  step(dt, plateOffset) {
    for (const c of this.list) {
      if (c.rest) continue;
      c.v[1] -= 981 * dt;
      for (let d = 0; d < 3; d++) c.p[d] += c.v[d] * dt;
      const g = groundAt(c.p[0], c.p[2], plateOffset).h + c.size * 0.35;
      if (c.p[1] < g) {
        c.p[1] = g;
        if (c.v[1] < 0) c.v[1] *= -0.28;
        c.v[0] *= 0.55; c.v[2] *= 0.55;
        for (let d = 0; d < 3; d++) c.w[d] *= 0.5;
        if (Math.abs(c.v[1]) < 4 && Math.hypot(c.v[0], c.v[2]) < 1.5) c.rest = true;
      }
      // spin
      const [wx, wy, wz] = c.w;
      const [x, y, z, w] = c.q;
      const h = dt * 0.5;
      const nq = [x + h * (wx * w + wy * z - wz * y), y + h * (wy * w + wz * x - wx * z), z + h * (wz * w + wx * y - wy * x), w - h * (wx * x + wy * y + wz * z)];
      const l = Math.hypot(...nq) || 1;
      c.q = nq.map((v) => v / l);
    }
  }

  pack() {
    const d = this.data;
    this.list.forEach((c, i) => {
      d.set([c.p[0], c.p[1], c.p[2], c.size, ...c.q, ...c.color, 1], i * 12);
    });
    return this.list.length;
  }
}
