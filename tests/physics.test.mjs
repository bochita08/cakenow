// Run: node tests/physics.test.mjs
import { JellySim } from '../src/sim.js';
import { skin, meshVolume } from '../src/surface.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const volumeNow = (sim) => {
  const pos = new Float32Array(sim.surf.nVerts * 3);
  skin(sim.surf, sim.x, pos);
  return meshVolume(pos, sim.surf.tris);
};
const restVolume = (sim) => meshVolume(sim.surf.rest, sim.surf.tris);
const run = (sim, seconds) => {
  const t0 = performance.now();
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) sim.step();
  return (performance.now() - t0) / steps;
};
const minY = (sim) => {
  let m = Infinity;
  for (let n = 0; n < sim.topo.nNodes; n++) m = Math.min(m, sim.x[n * 3 + 1]);
  return m;
};
const anyNaN = (sim) => sim.x.some((v) => !Number.isFinite(v));

let t0 = performance.now();
const sim = new JellySim();
const build = performance.now() - t0;
const t = sim.topo;
console.log(`build ${build.toFixed(0)} ms · copies ${t.nCopies} · nodes ${t.nNodes} · verts ${sim.surf.nVerts} · tris ${sim.surf.tris.length / 3} · probes ${sim.surf.probes.length}`);
check('one piece at start', t.pieces.length === 1, `${t.pieces.length}`);
const v0 = restVolume(sim);
check('rest volume plausible (cm³)', v0 > 300 && v0 < 700, v0.toFixed(1));
check('mass ≈ volume × 1.05', Math.abs(sim.totalMass() - v0 * 1.05) / (v0 * 1.05) < 0.08, `${sim.totalMass().toFixed(0)} g`);

const ms = run(sim, 3);
check('no NaN after landing', !anyNaN(sim));
check('step cost < 12 ms', ms < 12, `${ms.toFixed(2)} ms/step`);
const vol = volumeNow(sim) / v0;
check('volume kept after landing', vol > 0.93 && vol < 1.05, `${(vol * 100).toFixed(1)} %`);
check('rests on the plate', minY(sim) > -0.6, `min y ${minY(sim).toFixed(2)}`);
const ke = sim.kineticEnergy();
check('wobble dies down', ke < 50, `${ke.toFixed(2)} µJ`);

// Cut down the middle
const before = sim.x.slice();
const cut = sim.cut([0], [0, 3, 0], [1, 0, 0]);
check('cut applied', cut);
check('cut makes two pieces', sim.topo.pieces.length === 2, `${sim.topo.pieces.length} pieces, volumes ${sim.topo.pieces.map((p) => p.volume.toFixed(0)).join(', ')}`);
run(sim, 2);
check('no NaN after cut', !anyNaN(sim));
const volCut = volumeNow(sim) / v0;
check('volume after cut ≈ 97–100 %', volCut > 0.88 && volCut < 1.05, `${(volCut * 100).toFixed(1)} %`);
void before;

// Cut one half again
sim.cut([0], ...(() => { const pose = sim.piecePose(0); return [[pose.c[0], 3, pose.c[2]], [0, 0, 1]]; })());
check('second cut → 3 pieces', sim.topo.pieces.length === 3, `${sim.topo.pieces.length}`);
run(sim, 2);
check('no NaN after second cut', !anyNaN(sim));

// Scoop
const p1 = sim.piecePose(1);
const restTop = [p1.c0[0], 6.0, p1.c0[2]];
const vBefore = sim.topo.pieces.reduce((s, p) => s + p.volume, 0);
const sc = sim.scoop(1, restTop, [1.6, 1.1, 1.6]);
const vAfter = sim.topo.pieces.reduce((s, p) => s + p.volume, 0);
check('scoop removes jelly', sc && vAfter < vBefore - 1, `${vBefore.toFixed(1)} → ${vAfter.toFixed(1)} cm³`);
t0 = performance.now();
sim.cut([0], [0, 3, 0], [0.6, 0, 0.8]);
console.log(`rebuild after cut ${(performance.now() - t0).toFixed(0)} ms`);
const ms2 = run(sim, 2);
check('no NaN at the end', !anyNaN(sim));
check('step cost with pieces < 14 ms', ms2 < 14, `${ms2.toFixed(2)} ms/step, ${sim.topo.pieces.length} pieces`);

console.log(failures ? `\n${failures} failing` : '\nall good');
process.exit(failures ? 1 : 0);
