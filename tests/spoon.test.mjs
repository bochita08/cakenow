// node tests/spoon.test.mjs — the spoon never dips below the plate during a scoop
import { JellyApp } from '../src/jelly-app.js';
import { groundAt } from '../src/sim.js';
import { spoonMesh } from '../src/gpu/meshes.js';

globalThis.matchMedia = () => ({ matches: false });
const app = new JellyApp({ canvas: {}, stage: {} });
app.renderer = { eye: [12, 15, 33], setBlob() {}, setBlobModel() {} };
app.worker = { postMessage() {} };
app.plateOffset = [0, 0];
const V = spoonMesh().verts;
const probes = [];
for (let i = 0; i < V.length / 6; i++) probes.push([V[i * 6], V[i * 6 + 1], V[i * 6 + 2]]);

let worst = Infinity, fails = 0;
const check = (m, label) => {
  for (const p of probes) {
    const wx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const wy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const wz = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    const gap = wy - groundAt(wx, wz, [0, 0]).h;
    if (gap < worst) worst = gap;
    if (gap < -0.15) { fails++; if (fails < 4) console.log('below plate', label, gap.toFixed(2)); }
  }
};
// hits all around the jelly, from the very foot to the top
const hits = [];
for (let a = 0; a < 360; a += 30) for (const [r, y, ny] of [[6.1, 0.3, 0], [5.9, 1.5, 0], [4.7, 3.8, 0.1], [2.0, 6.6, 0.9]]) {
  const t = (a * Math.PI) / 180;
  const n = [Math.cos(t) * (1 - ny), ny, Math.sin(t) * (1 - ny)];
  const l = Math.hypot(...n);
  hits.push({ point: [Math.cos(t) * r, y, Math.sin(t) * r], normal: n.map((v) => v / l), restPoint: [0, 0, 0], restNormal: [0, 1, 0], piece: 0 });
}
for (const hit of hits) {
  const tip = app.spoonFrame(hit.point);
  app.spoon = { phase: 'dip', target: hit, tip, t0: 0, from: [hit.point[0], hit.point[1] + 2.2, hit.point[2]], fromPitch: 0.3 };
  for (let t = 0; t <= 3; t += 1 / 60) {
    const m = app.spoonModel(t);
    if (!m) break;
    check(m, `${hit.point.map((v) => v.toFixed(1))} ${app.spoon.phase}`);
    if (app.spoon.phase === 'wait') {
      // a bite the size of the scoop, sitting where it was taken from
      const verts = [];
      for (let i = 0; i < 200; i++) {
        const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
        verts.push(hit.point[0] + 1.3 * r * Math.cos(th), hit.point[1] + 0.9 * u, hit.point[2] + 1.15 * r * Math.sin(th));
      }
      app.startScoopLift({ model: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), verts: Float32Array.from(verts) });
      // the bite must end up inside the bowl's footprint
      const f = app.spoon.blob.fit;
      let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < verts.length; i += 3) {
        const q = [0, 1, 2].map((d) => f[d] * verts[i] + f[4 + d] * verts[i + 1] + f[8 + d] * verts[i + 2] + f[12 + d]);
        for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], q[d]); hi[d] = Math.max(hi[d], q[d]); }
      }
      if (hi[0] - lo[0] > 3.35 || hi[2] - lo[2] > 2.35 || lo[1] < 0.05 || Math.abs((lo[0] + hi[0]) / 2) > 0.05) { fails++; console.log('bite does not fit', lo, hi); }
    }
  }
}
console.log(`lowest point of the spoon vs plate: ${worst.toFixed(2)} cm · ${fails ? fails + ' samples below' : 'never below'}`);
process.exit(fails ? 1 : 0);
