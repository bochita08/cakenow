// node tests/knife-screen.test.mjs — a finger stroke across what you SEE on screen cuts the dessert
import { JellySim } from '../src/sim.js';
import { composeDessert } from '../src/desserts.js';
import { JellyApp } from '../src/jelly-app.js';
import { perspective, lookAt, mul, invert, normalize, transformPoint } from '../src/math.js';

globalThis.matchMedia = () => ({ matches: false });
const W = 800, H = 600;
const eye = [36 * Math.cos(0.4) * Math.sin(0.32), 3 + 36 * Math.sin(0.4), 36 * Math.cos(0.4) * Math.cos(0.32)];
const viewProj = mul(perspective((30 * Math.PI) / 180, W / H, 1, 300), lookAt(eye, [0, 3, 0]));
const inv = invert(viewProj);
const renderer = {
  eye,
  updateMatrices() {},
  ray(px, py) {
    const x = (px / W) * 2 - 1, y = 1 - (py / H) * 2;
    const a = transformPoint(inv, [x, y, 0]), b = transformPoint(inv, [x, y, 1]);
    return { origin: a, dir: normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]) };
  },
};
const toScreen = (p) => {
  const c = transformPoint(viewProj, p);
  return [(c[0] * 0.5 + 0.5) * W, (0.5 - c[1] * 0.5) * H];
};

let fails = 0;
for (const id of ['gelatina', 'flan', 'tiramisu', 'brownie']) {
  const sim = new JellySim();
  sim.setDessert(composeDessert(id));
  for (let i = 0; i < 90; i++) sim.step();
  const app = new JellyApp({ canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }) }, stage: {} });
  app.renderer = renderer;
  app.mesh = { rest: sim.surf.rest, restNormals: sim.surf.restNormals, vNodes: sim.surf.vNodes, vW: sim.surf.vW, vPiece: sim.surf.vPiece, tris: sim.surf.tris };
  app.skinned = new Float32Array(sim.surf.rest.length);
  app.x = Float32Array.from(sim.x);
  app.frameId = 1;
  // top of the dessert as seen on screen
  let top = [0, 0, 0];
  for (let n = 0; n < sim.topo.nNodes; n++) if (sim.x[n * 3 + 1] > top[1]) top = [0, sim.x[n * 3 + 1] - 0.4, 0];
  const c = toScreen(top);
  const stroke = (dx, dy, sideShift) => {
    const sa = [c[0] - dx + sideShift, c[1] - dy], sb = [c[0] + dx + sideShift, c[1] + dy];
    // while drawing, the line lives on the starting height (here: off the dessert, the default)
    const a = JellyApp.rayPlane(app.rayFromClient(...sa), [0, 3.5, 0], [0, 1, 0]);
    const b = JellyApp.rayPlane(app.rayFromClient(...sb), [0, 3.5, 0], [0, 1, 0]);
    app.knife = { phase: 'drawing', h: 3.5, a, b, sa, sb, dir: [1, 0, 0] };
    app.releaseKnife();
    const k = app.knife;
    if (k.phase !== 'fall') return [];
    const z = normalize([k.dir[2], 0, -k.dir[0]]);
    return app.piecesCrossing(k.a, k.dir, k.len, z);
  };
  const across = [stroke(120, 0, 0), stroke(0, 60, 0), stroke(90, 45, 0), stroke(90, -45, 0)];
  const miss = stroke(0, 60, 380);
  const ok = across.every((p) => p.length === 1) && miss.length === 0;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id.padEnd(9)} trazos que cruzan: ${across.map((p) => (p.length ? 'corta' : 'NO')).join(', ')} · trazo al costado: ${miss.length ? 'corta (mal)' : 'no corta'}`);
}
process.exit(fails ? 1 : 0);
