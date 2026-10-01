// Runs the simulation off the main thread and streams node positions/rotations to the page.

import { JellySim, DT } from './sim.js';
import { skin, meshVolume, marchTets } from './surface.js';
import { ellipsoidSdf, NFN, finePos } from './sdf.js';
import { composeDessert } from './desserts.js';

const sim = new JellySim();
let paused = false;
let acc = 0;
let last = performance.now();
let frame = 0;
let stats = { volume: 100, pieces: 1, mass: 0, energy: 0 };
let skinBuf = null;
let restVolumeMesh = null;

function nodeRotations() {
  const t = sim.topo;
  const out = new Float32Array(t.nNodes * 4);
  const ref = new Float32Array(t.nNodes * 4);
  const has = new Uint8Array(t.nNodes);
  for (let cp = 0; cp < t.nCopies; cp++) {
    const qx = sim.q[cp * 4], qy = sim.q[cp * 4 + 1], qz = sim.q[cp * 4 + 2], qw = sim.q[cp * 4 + 3];
    for (let c = 0; c < 8; c++) {
      const n = t.copyNodes[cp * 8 + c];
      const w = sim.wN[cp * 8 + c] + 0.01;
      let s = w;
      if (!has[n]) {
        has[n] = 1;
        ref[n * 4] = qx; ref[n * 4 + 1] = qy; ref[n * 4 + 2] = qz; ref[n * 4 + 3] = qw;
      } else if (ref[n * 4] * qx + ref[n * 4 + 1] * qy + ref[n * 4 + 2] * qz + ref[n * 4 + 3] * qw < 0) {
        s = -w; // same rotation, opposite hemisphere
      }
      out[n * 4] += qx * s; out[n * 4 + 1] += qy * s; out[n * 4 + 2] += qz * s; out[n * 4 + 3] += qw * s;
    }
  }
  for (let n = 0; n < t.nNodes; n++) {
    const l = Math.hypot(out[n * 4], out[n * 4 + 1], out[n * 4 + 2], out[n * 4 + 3]) || 1;
    for (let d = 0; d < 4; d++) out[n * 4 + d] /= l;
  }
  return out;
}

// Ingredient list + map go with the mesh whenever the dessert itself changes.
function dessertInfo() {
  return {
    dessert: { id: sim.comp.id, toppings: sim.comp.toppings, materials: sim.comp.materials },
    matGrid: sim.matGrid,
  };
}

function sendMesh(extra = {}) {
  const s = sim.surf;
  skinBuf = new Float32Array(s.nVerts * 3);
  if (restVolumeMesh === null) restVolumeMesh = meshVolume(s.rest, s.tris);
  postMessage({
    type: 'mesh',
    version: sim.version,
    nNodes: sim.topo.nNodes,
    rest: s.rest,
    restNormals: s.restNormals,
    vNodes: s.vNodes,
    vW: s.vW,
    vPiece: s.vPiece,
    tris: s.tris,
    pieces: sim.topo.pieces.length,
    copyNodes: sim.topo.copyNodes,
    ...extra,
  });
}

function sendFrame() {
  const x = new Float32Array(sim.x);
  const rot = nodeRotations();
  if (frame % 8 === 0) {
    skin(sim.surf, sim.x, skinBuf);
    stats = {
      volume: (meshVolume(skinBuf, sim.surf.tris) / restVolumeMesh) * 100,
      pieces: sim.topo.pieces.length,
      mass: sim.totalMass(),
      energy: sim.kineticEnergy(),
    };
  }
  postMessage({ type: 'frame', version: sim.version, x, rot, stats, plate: sim.plate.offset.slice() }, [x.buffer, rot.buffer]);
}

// Slow phones: fewer substeps (the solver compensates) so the simulation keeps real time.
let cost = 0;
let lastAdapt = 0;
function adapt(ms) {
  cost = cost ? cost * 0.95 + ms * 0.05 : ms;
  const now = performance.now();
  if (now - lastAdapt < 1500) return;
  const n = sim.substeps || 10;
  if (cost > 13 && n > 4) { sim.substeps = n > 6 ? 6 : 4; lastAdapt = now; cost *= 0.6; }
  else if (cost < 5 && n < 10) { sim.substeps = n < 6 ? 6 : 10; lastAdapt = now; cost *= 1.4; }
}

function loop() {
  const now = performance.now();
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    let steps = 0;
    while (acc >= DT && steps < 2) {
      const t0 = performance.now();
      sim.step();
      adapt(performance.now() - t0);
      acc -= DT;
      steps++;
      frame++;
    }
    if (steps >= 2) acc = Math.min(acc, DT);
    if (steps) sendFrame();
  } else {
    acc = 0;
  }
  setTimeout(loop, Math.max(0, DT * 1000 - (performance.now() - now)));
}

// Rest-space mesh of the jelly a scoop removed, posed where it was taken from.
function scoopBlob(res) {
  const tmp = new Float32Array(NFN[0] * NFN[1] * NFN[2]).fill(1);
  const ell = ellipsoidSdf(res.center, res.radii);
  const [lo, hi] = res.bounds;
  for (let i = lo[0]; i <= hi[0]; i++)
    for (let j = lo[1]; j <= hi[1]; j++)
      for (let k = lo[2]; k <= hi[2]; k++) {
        const n = (i * NFN[1] + j) * NFN[2] + k;
        const p = finePos(i, j, k);
        let d = res.mask[n] ? Math.max(res.before[n], ell(p[0], p[1], p[2])) : 1;
        if (i === lo[0] || j === lo[1] || k === lo[2] || i === hi[0] || j === hi[1] || k === hi[2]) d = Math.max(d, 0.01);
        if (Math.abs(d) < 1e-4) d = 1e-4;
        tmp[n] = d;
      }
  const m = marchTets(tmp, () => 0, [lo, [hi[0], hi[1], hi[2]]]);
  if (!m.tris.length) return null;
  const { R, c, c0 } = res.pose;
  // world = R·(p − c0) + c, as a column-major matrix
  const model = new Float32Array([
    R[0], R[3], R[6], 0,
    R[1], R[4], R[7], 0,
    R[2], R[5], R[8], 0,
    c[0] - (R[0] * c0[0] + R[1] * c0[1] + R[2] * c0[2]),
    c[1] - (R[3] * c0[0] + R[4] * c0[1] + R[5] * c0[2]),
    c[2] - (R[6] * c0[0] + R[7] * c0[1] + R[8] * c0[2]),
    1,
  ]);
  let cx = 0, cy = 0, cz = 0;
  const nv = m.verts.length / 3;
  for (let v = 0; v < nv; v++) { cx += m.verts[v * 3]; cy += m.verts[v * 3 + 1]; cz += m.verts[v * 3 + 2]; }
  return { verts: m.verts, normals: m.normals, tris: m.tris, model, center: [cx / nv, cy / nv, cz / nv] };
}

onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case 'params':
      Object.assign(sim.params, m.params);
      break;
    case 'pause':
      paused = m.paused;
      last = performance.now();
      break;
    case 'grab':
      sim.startGrab(m.piece, m.restPoint, m.worldPoint);
      break;
    case 'grabMove':
      sim.moveGrab(m.worldPoint);
      break;
    case 'grabEnd':
      sim.endGrab();
      break;
    case 'shake':
      sim.shakePlate(m.dir[0], m.dir[1], m.amp);
      break;
    case 'poke':
      sim.poke(m.point, m.dir, m.strength);
      break;
    case 'cut': {
      const ok = sim.cut(m.pieces, m.point, m.normal);
      if (ok) sendMesh({ reason: 'cut' });
      else postMessage({ type: 'noop', reason: 'cut' });
      break;
    }
    case 'scoop': {
      const res = sim.scoop(m.piece, m.restCenter, m.radii);
      if (res) sendMesh({ reason: 'scoop', blob: scoopBlob(res), scoopId: m.scoopId });
      else postMessage({ type: 'noop', reason: 'scoop', scoopId: m.scoopId });
      break;
    }
    case 'reset':
      sim.reset();
      restVolumeMesh = null;
      sendMesh({ reason: 'reset', ...dessertInfo() });
      break;
    case 'dessert':
      sim.setDessert(composeDessert(m.id, m.toppings, m.flavor));
      restVolumeMesh = null;
      sendMesh({ reason: 'dessert', ...dessertInfo() });
      break;
  }
};

sendMesh({ reason: 'init', ...dessertInfo() });
loop();
