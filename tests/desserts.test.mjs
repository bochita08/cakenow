// node tests/desserts.test.mjs — every dessert lands, settles, cuts and scoops cleanly
import { JellySim } from '../src/sim.js';
import { DESSERTS, composeDessert } from '../src/desserts.js';
import { skin, meshVolume } from '../src/surface.js';

let fails = 0;
const sim = new JellySim();
const vol = () => {
  const pos = new Float32Array(sim.surf.nVerts * 3);
  skin(sim.surf, sim.x, pos);
  return meshVolume(pos, sim.surf.tris) / meshVolume(sim.surf.rest, sim.surf.tris);
};
const bad = () => sim.x.some((v) => !Number.isFinite(v));
for (const d of DESSERTS) {
  for (const tops of [[], ['ddl', 'crema']]) {
    const comp = composeDessert(d.id, tops);
    sim.params.firmness = d.feel.firmness;
    sim.params.damping = d.feel.damping;
    sim.setDessert(comp);
    const pieces0 = sim.topo.pieces.length;
    for (let i = 0; i < 150; i++) sim.step();
    const v = vol();
    let minY = Infinity, maxY = -Infinity;
    for (let n = 0; n < sim.topo.nNodes; n++) { minY = Math.min(minY, sim.x[n * 3 + 1]); maxY = Math.max(maxY, sim.x[n * 3 + 1]); }
    const p = sim.piecePose(0);
    sim.cut([0], [p.c[0], 3, p.c[2]], [1, 0, 0]);
    const pieces1 = sim.topo.pieces.length;
    for (let i = 0; i < 60; i++) sim.step();
    const top = sim.piecePose(0);
    const sc = sim.scoop(0, [top.c0[0], top.c0[1] + 1.5, top.c0[2]], [1.3, 0.9, 1.15]);
    for (let i = 0; i < 60; i++) sim.step();
    const ok = pieces0 === 1 + tops.length && pieces1 >= pieces0 + 1 && v > 0.85 && v < 1.08 && !bad() && minY > -1;
    if (!ok) fails++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${(d.id + (tops.length ? '+ddl+crema' : '')).padEnd(22)} piezas ${pieces0}→${pieces1} · volumen ${(v * 100).toFixed(1)}% · alto ${maxY.toFixed(1)} cm · cucharada ${sc ? 'sí' : 'no'} · energía ${sim.kineticEnergy().toFixed(1)} µJ`);
  }
}
console.log(fails ? `${fails} failing` : 'all good');
process.exit(fails ? 1 : 0);
