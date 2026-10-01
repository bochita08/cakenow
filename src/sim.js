// Soft-body simulation of the dessert: position-based dynamics on the hexahedral copies built by
// topology.js. Each element is pulled toward its best-fit rotated rest shape (co-rotational shape
// matching); damping acts only on motion relative to the element, so pieces still fall freely.

import { extractRotation, smoothstep } from './math.js';
import { createField, subtract, slabSdf, ellipsoidSdf, FINE, NF, ORIGIN, fineCellIndex, createMaterialGrid, materialAt } from './sdf.js';
import { composeDessert } from './desserts.js';
import { buildTopology, transferState, pieceNodeMask, fineCellNodes } from './topology.js';
import { buildSurface } from './surface.js';

export const GRAVITY = -981; // cm/s²
export const DT = 1 / 60;
export const SUBSTEPS = 10;

// Plate: flat well, curved rim, then the table 1.45 cm lower.
export const PLATE = { flat: 9.4, rim: 11.6, lip: 12.3, rimHeight: 1.25, table: -1.45 };

export function groundAt(x, z, plateOffset) {
  const lx = x - plateOffset[0], lz = z - plateOffset[1];
  const r = Math.hypot(lx, lz);
  if (r <= PLATE.flat) return { h: 0, nx: 0, ny: 1, nz: 0, onPlate: true };
  if (r <= PLATE.rim) {
    const t = (r - PLATE.flat) / (PLATE.rim - PLATE.flat);
    const h = PLATE.rimHeight * t * t;
    const slope = (2 * PLATE.rimHeight * t) / (PLATE.rim - PLATE.flat);
    const inv = 1 / Math.sqrt(1 + slope * slope);
    return { h, nx: (-slope * lx) / r * inv, ny: inv, nz: (-slope * lz) / r * inv, onPlate: true };
  }
  if (r <= PLATE.lip) return { h: PLATE.rimHeight, nx: 0, ny: 1, nz: 0, onPlate: true };
  return { h: PLATE.table, nx: 0, ny: 1, nz: 0, onPlate: false };
}

export class JellySim {
  constructor() {
    this.params = { firmness: 0.45, damping: 0.45, timeScale: 1 };
    this.plate = { offset: [0, 0], prev: [0, 0], shakeT: -1, shakeDir: [1, 0], shakeAmp: 0 };
    this.grab = null;
    this.time = 0;
    this.setDessert(composeDessert('gelatina'));
  }

  setDessert(comp) {
    this.comp = comp;
    this.reset();
  }

  reset() {
    this.phi = createField(this.comp.sdf);
    this.matGrid = createMaterialGrid(this.comp.material, this.phi);
    this.restVolume = null;
    this.setTopology(buildTopology(this.phi));
    this.x = Float64Array.from(this.topo.rest);
    // start a little above the plate so it lands with a wobble
    for (let n = 0; n < this.topo.nNodes; n++) this.x[n * 3 + 1] += 0.6;
    this.v = new Float64Array(this.topo.nNodes * 3);
    this.xPrev = Float64Array.from(this.x);
    this.grab = null;
    this.version = (this.version || 0) + 1;
  }

  setTopology(topo) {
    this.topo = topo;
    this.surf = buildSurface(this.phi, topo);
    const nC = topo.nCopies;
    this.invMass = new Float64Array(topo.nNodes);
    for (let n = 0; n < topo.nNodes; n++) this.invMass[n] = 1 / Math.max(topo.mass[n], 1e-4);
    // per-copy rest shape around its weighted centroid
    this.restC = new Float64Array(nC * 24);
    this.wN = new Float64Array(nC * 8);
    this.q = new Float64Array(nC * 4);
    for (let cp = 0; cp < nC; cp++) {
      let ws = 0, cx = 0, cy = 0, cz = 0;
      for (let c = 0; c < 8; c++) {
        const w = topo.copyW[cp * 8 + c];
        const n = topo.copyNodes[cp * 8 + c];
        ws += w;
        cx += w * topo.rest[n * 3];
        cy += w * topo.rest[n * 3 + 1];
        cz += w * topo.rest[n * 3 + 2];
      }
      cx /= ws; cy /= ws; cz /= ws;
      for (let c = 0; c < 8; c++) {
        const n = topo.copyNodes[cp * 8 + c];
        this.wN[cp * 8 + c] = topo.copyW[cp * 8 + c] / ws;
        this.restC[cp * 24 + c * 3] = topo.rest[n * 3] - cx;
        this.restC[cp * 24 + c * 3 + 1] = topo.rest[n * 3 + 1] - cy;
        this.restC[cp * 24 + c * 3 + 2] = topo.rest[n * 3 + 2] - cz;
      }
      this.q[cp * 4 + 3] = 1;
    }
    // each element takes the firmness of the ingredient at its centre (crust hard, cream soft)
    this.kMul = new Float64Array(nC);
    for (let cp = 0; cp < nC; cp++) {
      let ws = 0, cx = 0, cy = 0, cz = 0;
      for (let c = 0; c < 8; c++) {
        const w = topo.copyW[cp * 8 + c], n = topo.copyNodes[cp * 8 + c];
        ws += w; cx += w * topo.rest[n * 3]; cy += w * topo.rest[n * 3 + 1]; cz += w * topo.rest[n * 3 + 2];
      }
      const mat = this.comp.materials[materialAt(this.matGrid, cx / ws, cy / ws, cz / ws)] || this.comp.materials[0];
      this.kMul[cp] = mat.stiff ?? 1;
    }
    if (this.restVolume === null) this.restVolume = topo.pieces.reduce((s, p) => s + p.volume, 0);
  }

  // Per-substep rates are tuned for 10 substeps; with fewer substeps (slow phones) each one must
  // do proportionally more so the dessert feels the same.
  rate(r) {
    const n = this.substeps || SUBSTEPS;
    return n === SUBSTEPS ? r : 1 - Math.pow(1 - Math.min(r, 0.999), SUBSTEPS / n);
  }

  get stiffness() {
    const f = this.params.firmness;
    return 0.035 + 0.6 * f * f;
  }

  // ---- interaction ----

  startGrab(pieceId, restPoint, worldPoint) {
    const nodes = [], weights = [];
    const radius = 1.6;
    const t = this.topo;
    for (const n of t.pieces[pieceId].nodes) {
      const d = Math.hypot(t.rest[n * 3] - restPoint[0], t.rest[n * 3 + 1] - restPoint[1], t.rest[n * 3 + 2] - restPoint[2]);
      if (d < radius) {
        nodes.push(n);
        weights.push(1 - smoothstep(0.3 * radius, radius, d));
      }
    }
    if (!nodes.length) return false;
    this.grab = { nodes: Int32Array.from(nodes), weights: Float64Array.from(weights), target: worldPoint.slice(), version: this.version };
    return true;
  }

  moveGrab(worldPoint) {
    if (this.grab) this.grab.target = worldPoint.slice();
  }

  endGrab() {
    this.grab = null;
  }

  grabAnchor() {
    const g = this.grab;
    let s = 0, ax = 0, ay = 0, az = 0;
    for (let i = 0; i < g.nodes.length; i++) {
      const n = g.nodes[i] * 3, w = g.weights[i];
      ax += w * this.x[n]; ay += w * this.x[n + 1]; az += w * this.x[n + 2];
      s += w;
    }
    return [ax / s, ay / s, az / s];
  }

  shakePlate(dirX = 1, dirZ = 0.35, amp = 0.9) {
    const l = Math.hypot(dirX, dirZ) || 1;
    this.plate.shakeT = 0;
    this.plate.shakeDir = [dirX / l, dirZ / l];
    this.plate.shakeAmp = amp;
  }

  poke(worldPoint, dir, strength = 140) {
    const x = this.x;
    for (let n = 0; n < this.topo.nNodes; n++) {
      const d = Math.hypot(x[n * 3] - worldPoint[0], x[n * 3 + 1] - worldPoint[1], x[n * 3 + 2] - worldPoint[2]);
      const f = 1 - smoothstep(0, 3.2, d);
      if (f <= 0) continue;
      this.v[n * 3] += dir[0] * strength * f;
      this.v[n * 3 + 1] += dir[1] * strength * f;
      this.v[n * 3 + 2] += dir[2] * strength * f;
    }
  }

  // Best-fit rigid pose of a piece: rest point r maps to R·(r − c0) + c.
  piecePose(pieceId) {
    const t = this.topo, p = t.pieces[pieceId], x = this.x;
    let m = 0;
    const c = [0, 0, 0], c0 = [0, 0, 0];
    for (const n of p.nodes) {
      const w = t.mass[n];
      m += w;
      for (let d = 0; d < 3; d++) {
        c[d] += w * x[n * 3 + d];
        c0[d] += w * t.rest[n * 3 + d];
      }
    }
    for (let d = 0; d < 3; d++) { c[d] /= m; c0[d] /= m; }
    const A = new Float64Array(9);
    for (const n of p.nodes) {
      const w = t.mass[n];
      for (let r = 0; r < 3; r++)
        for (let cc = 0; cc < 3; cc++) A[r * 3 + cc] += w * (x[n * 3 + r] - c[r]) * (t.rest[n * 3 + cc] - c0[cc]);
    }
    const q = new Float64Array([0, 0, 0, 1]);
    extractRotation(A, q, 0, 40);
    const [qx, qy, qz, qw] = q;
    const Rm = [
      1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw),
      2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw),
      2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy),
    ];
    return { R: Rm, c, c0 };
  }

  worldToRest(pose, p) {
    const d = [p[0] - pose.c[0], p[1] - pose.c[1], p[2] - pose.c[2]];
    const R = pose.R; // inverse = transpose
    return [
      R[0] * d[0] + R[3] * d[1] + R[6] * d[2] + pose.c0[0],
      R[1] * d[0] + R[4] * d[1] + R[7] * d[2] + pose.c0[1],
      R[2] * d[0] + R[5] * d[1] + R[8] * d[2] + pose.c0[2],
    ];
  }

  dirToRest(pose, d) {
    const R = pose.R;
    return [R[0] * d[0] + R[3] * d[1] + R[6] * d[2], R[1] * d[0] + R[4] * d[1] + R[7] * d[2], R[2] * d[0] + R[5] * d[1] + R[8] * d[2]];
  }

  /** Cut every listed piece along a world-space plane. Returns true if anything was cut. */
  cut(pieceIds, planePoint, planeNormal) {
    let changed = 0;
    for (const id of pieceIds) {
      const pose = this.piecePose(id);
      const p = this.worldToRest(pose, planePoint);
      const n = this.dirToRest(pose, planeNormal);
      const { mask, bounds } = pieceNodeMask(this.topo, id);
      changed += subtract(this.phi, mask, slabSdf(p, n, FINE * 0.85), bounds);
    }
    if (!changed) return false;
    this.rebuild();
    // nudge the new faces apart so the cut reads clearly
    this.separateAlong(planePoint, planeNormal, 9);
    return true;
  }

  /** Scoop an ellipsoid (rest-space centre in piece `id`). Returns the removed jelly as a rest-space blob SDF, or null. */
  scoop(pieceId, restCenter, radii) {
    const { mask, bounds } = pieceNodeMask(this.topo, pieceId);
    const before = this.phi.slice();
    const lo = bounds[0].map((v, i) => Math.max(0, Math.min(v, Math.floor((restCenter[i] - radii[i] - ORIGIN[i]) / FINE) - 1)));
    const hi = bounds[1].map((v, i) => Math.min(NF[i], Math.max(lo[i], Math.ceil((restCenter[i] + radii[i] - ORIGIN[i]) / FINE) + 1)));
    const changed = subtract(this.phi, mask, ellipsoidSdf(restCenter, radii), [lo, hi]);
    if (!changed) return null;
    const pose = this.piecePose(pieceId);
    this.rebuild();
    return { before, mask, center: restCenter, radii, pose, bounds: [lo, hi] };
  }

  separateAlong(point, normal, speed) {
    for (let n = 0; n < this.topo.nNodes; n++) {
      const s = (this.x[n * 3] - point[0]) * normal[0] + (this.x[n * 3 + 1] - point[1]) * normal[1] + (this.x[n * 3 + 2] - point[2]) * normal[2];
      const sign = s >= 0 ? 1 : -1;
      this.v[n * 3] += normal[0] * speed * sign;
      this.v[n * 3 + 1] += normal[1] * speed * sign;
      this.v[n * 3 + 2] += normal[2] * speed * sign;
    }
  }

  rebuild() {
    for (let pass = 0; pass < 3; pass++) {
      const oldTopo = this.topo;
      const topo = buildTopology(this.phi);
      const { x, v } = transferState(oldTopo, this.x, this.v, topo);
      this.x = x;
      this.v = v;
      this.xPrev = Float64Array.from(x);
      this.setTopology(topo);
      // crumbs smaller than ~0.35 cm³ are dropped
      const tiny = topo.pieces.filter((p) => p.volume < 0.35);
      if (!tiny.length) break;
      const nodes8 = new Int32Array(8);
      const drop = new Set(tiny.map((p) => p.id));
      for (let i = 0; i < NF[0]; i++)
        for (let j = 0; j < NF[1]; j++)
          for (let k = 0; k < NF[2]; k++) {
            const cp = topo.fineCopy[fineCellIndex(i, j, k)];
            if (cp < 0 || !drop.has(topo.copyPiece[cp])) continue;
            fineCellNodes(i, j, k, nodes8);
            for (let c = 0; c < 8; c++) this.phi[nodes8[c]] = Math.max(this.phi[nodes8[c]], FINE * 0.5);
          }
    }
    this.grab = null;
    this.version++;
  }

  // ---- stepping ----

  step() {
    const dt = DT * this.params.timeScale;
    const n = this.substeps || SUBSTEPS;
    const h = dt / n;
    for (let s = 0; s < n; s++) {
      this.time += h;
      this.updatePlate(h);
      this.substep(h);
    }
  }

  updatePlate(h) {
    const p = this.plate;
    p.prev[0] = p.offset[0];
    p.prev[1] = p.offset[1];
    if (p.shakeT >= 0) {
      p.shakeT += h;
      const env = Math.exp(-p.shakeT / 0.22) * Math.min(1, p.shakeT / 0.03);
      const a = p.shakeAmp * env * Math.sin(2 * Math.PI * 4.2 * p.shakeT);
      p.offset[0] = p.shakeDir[0] * a;
      p.offset[1] = p.shakeDir[1] * a;
      if (p.shakeT > 1.4) {
        p.shakeT = -1;
        p.offset[0] = p.offset[1] = 0;
      }
    }
  }

  substep(h) {
    const { x, v, xPrev, invMass } = this;
    const nN = this.topo.nNodes;
    for (let i = 0; i < nN * 3; i += 3) {
      v[i + 1] += GRAVITY * h;
      xPrev[i] = x[i]; xPrev[i + 1] = x[i + 1]; xPrev[i + 2] = x[i + 2];
      x[i] += v[i] * h; x[i + 1] += v[i + 1] * h; x[i + 2] += v[i + 2] * h;
    }
    this.solveShapes();
    if (this.grab) this.solveGrab();
    this.solveContacts(h);
    const inv = 1 / h;
    for (let i = 0; i < nN * 3; i++) v[i] = (x[i] - xPrev[i]) * inv;
    this.dampRelative();
    void invMass;
  }

  solveShapes() {
    const { x, q, restC, wN } = this;
    const nodes = this.topo.copyNodes;
    const nC = this.topo.nCopies;
    const kBase = this.stiffness;
    const kMul = this.kMul;
    const A = new Float64Array(9);
    for (let cp = 0; cp < nC; cp++) {
      const b8 = cp * 8, b24 = cp * 24;
      let cx = 0, cy = 0, cz = 0;
      for (let c = 0; c < 8; c++) {
        const n = nodes[b8 + c] * 3, w = wN[b8 + c];
        cx += w * x[n]; cy += w * x[n + 1]; cz += w * x[n + 2];
      }
      A.fill(0);
      for (let c = 0; c < 8; c++) {
        const n = nodes[b8 + c] * 3, w = wN[b8 + c];
        const px = (x[n] - cx) * w, py = (x[n + 1] - cy) * w, pz = (x[n + 2] - cz) * w;
        const rx = restC[b24 + c * 3], ry = restC[b24 + c * 3 + 1], rz = restC[b24 + c * 3 + 2];
        A[0] += px * rx; A[1] += px * ry; A[2] += px * rz;
        A[3] += py * rx; A[4] += py * ry; A[5] += py * rz;
        A[6] += pz * rx; A[7] += pz * ry; A[8] += pz * rz;
      }
      extractRotation(A, q, cp * 4, 2);
      const k = this.rate(Math.min(0.92, kBase * kMul[cp]));
      const qx = q[cp * 4], qy = q[cp * 4 + 1], qz = q[cp * 4 + 2], qw = q[cp * 4 + 3];
      const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qz * qw), r02 = 2 * (qx * qz + qy * qw);
      const r10 = 2 * (qx * qy + qz * qw), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qx * qw);
      const r20 = 2 * (qx * qz - qy * qw), r21 = 2 * (qy * qz + qx * qw), r22 = 1 - 2 * (qx * qx + qy * qy);
      for (let c = 0; c < 8; c++) {
        const n = nodes[b8 + c] * 3;
        const rx = restC[b24 + c * 3], ry = restC[b24 + c * 3 + 1], rz = restC[b24 + c * 3 + 2];
        const gx = r00 * rx + r01 * ry + r02 * rz + cx;
        const gy = r10 * rx + r11 * ry + r12 * rz + cy;
        const gz = r20 * rx + r21 * ry + r22 * rz + cz;
        x[n] += (gx - x[n]) * k;
        x[n + 1] += (gy - x[n + 1]) * k;
        x[n + 2] += (gz - x[n + 2]) * k;
      }
    }
  }

  solveGrab() {
    const g = this.grab;
    const a = this.grabAnchor();
    let dx = g.target[0] - a[0], dy = g.target[1] - a[1], dz = g.target[2] - a[2];
    const dist = Math.hypot(dx, dy, dz);
    const maxPull = 3.2; // bounded reach: the hand can only stretch it so far per step
    if (dist > maxPull) {
      const s = maxPull / dist;
      dx *= s; dy *= s; dz *= s;
    }
    const k = this.rate(0.22);
    for (let i = 0; i < g.nodes.length; i++) {
      const n = g.nodes[i] * 3, w = g.weights[i] * k;
      this.x[n] += dx * w;
      this.x[n + 1] += dy * w;
      this.x[n + 2] += dz * w;
    }
  }

  probePos(v, src, out) {
    const { vNodes, vW } = this.surf;
    let px = 0, py = 0, pz = 0;
    const b = v * 8;
    for (let c = 0; c < 8; c++) {
      const w = vW[b + c];
      if (w === 0) continue;
      const n = vNodes[b + c] * 3;
      px += w * src[n]; py += w * src[n + 1]; pz += w * src[n + 2];
    }
    out[0] = px; out[1] = py; out[2] = pz;
    return out;
  }

  // Move an embedded point by d, spreading the move over its element's corners (PBD, mass weighted).
  displaceProbe(v, dx, dy, dz) {
    const { vNodes, vW } = this.surf;
    const b = v * 8;
    let den = 0;
    for (let c = 0; c < 8; c++) {
      const w = vW[b + c];
      den += w * w * this.invMass[vNodes[b + c]];
    }
    if (den <= 0) return;
    for (let c = 0; c < 8; c++) {
      const w = vW[b + c];
      if (w === 0) continue;
      const n = vNodes[b + c];
      const s = (w * this.invMass[n]) / den;
      this.x[n * 3] += dx * s;
      this.x[n * 3 + 1] += dy * s;
      this.x[n * 3 + 2] += dz * s;
    }
  }

  solveContacts(h) {
    const probes = this.surf.probes;
    const p = [0, 0, 0], pp = [0, 0, 0];
    const plate = this.plate;
    const pdx = plate.offset[0] - plate.prev[0], pdz = plate.offset[1] - plate.prev[1];
    const muS = 0.9, muK = 0.6;
    for (let i = 0; i < probes.length; i++) {
      const v = probes[i];
      this.probePos(v, this.x, p);
      const g = groundAt(p[0], p[2], plate.offset);
      const pen = (g.h - p[1]) * g.ny;
      if (pen <= 0) continue;
      this.displaceProbe(v, g.nx * pen, g.ny * pen, g.nz * pen);
      // friction against the (possibly moving) plate
      this.probePos(v, this.x, p);
      this.probePos(v, this.xPrev, pp);
      let tx = p[0] - pp[0] - (g.onPlate ? pdx : 0);
      let ty = p[1] - pp[1];
      let tz = p[2] - pp[2] - (g.onPlate ? pdz : 0);
      const dn = tx * g.nx + ty * g.ny + tz * g.nz;
      tx -= dn * g.nx; ty -= dn * g.ny; tz -= dn * g.nz;
      const tl = Math.hypot(tx, ty, tz);
      if (tl < 1e-9) continue;
      const f = tl < muS * pen ? 1 : Math.min(1, (muK * pen) / tl);
      this.displaceProbe(v, -tx * f, -ty * f, -tz * f);
    }
    this._sub = (this._sub || 0) + 1;
    if (this.topo.pieces.length > 1 && this._sub % 2 === 0) this.solvePieceContacts();
    void h;
  }

  solvePieceContacts() {
    const probes = this.surf.probes;
    const piece = this.surf.vPiece;
    const n = probes.length;
    const TABLE = 8192;
    if (!this._pp || this._pp.length < n * 3) {
      this._pp = new Float64Array(n * 3);
      this._pc = new Int32Array(n);
      this._sorted = new Int32Array(n);
      this._start = new Int32Array(TABLE + 1);
    }
    const P = this._pp, cellOf = this._pc, sorted = this._sorted, start = this._start;
    const tmp = [0, 0, 0];
    const cell = 0.6;
    const hash = (x, y, z) => ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0) & (TABLE - 1);
    start.fill(0);
    for (let i = 0; i < n; i++) {
      this.probePos(probes[i], this.x, tmp);
      P[i * 3] = tmp[0]; P[i * 3 + 1] = tmp[1]; P[i * 3 + 2] = tmp[2];
      const hc = hash(Math.floor(tmp[0] / cell), Math.floor(tmp[1] / cell), Math.floor(tmp[2] / cell));
      cellOf[i] = hc;
      start[hc + 1]++;
    }
    for (let c = 0; c < TABLE; c++) start[c + 1] += start[c];
    const fill = start.slice(0, TABLE);
    for (let i = 0; i < n; i++) sorted[fill[cellOf[i]]++] = i;
    const minD = 0.5;
    for (let i = 0; i < n; i++) {
      const gx = Math.floor(P[i * 3] / cell), gy = Math.floor(P[i * 3 + 1] / cell), gz = Math.floor(P[i * 3 + 2] / cell);
      const pi = piece[probes[i]];
      for (let ax = -1; ax <= 1; ax++)
        for (let ay = -1; ay <= 1; ay++)
          for (let az = -1; az <= 1; az++) {
            const hc = hash(gx + ax, gy + ay, gz + az);
            for (let s = start[hc], e = start[hc + 1]; s < e; s++) {
              const j = sorted[s];
              if (j <= i || piece[probes[j]] === pi) continue;
              const dx = P[j * 3] - P[i * 3], dy = P[j * 3 + 1] - P[i * 3 + 1], dz = P[j * 3 + 2] - P[i * 3 + 2];
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 >= minD * minD || d2 < 1e-12) continue;
              const d = Math.sqrt(d2);
              const corr = Math.min(0.08, (minD - d) * 0.5) / d;
              this.displaceProbe(probes[i], -dx * corr, -dy * corr, -dz * corr);
              this.displaceProbe(probes[j], dx * corr, dy * corr, dz * corr);
            }
          }
    }
  }

  dampRelative() {
    const { v, wN } = this;
    const nodes = this.topo.copyNodes;
    const nC = this.topo.nCopies;
    const d = this.rate(0.004 + 0.06 * this.params.damping * this.params.damping);
    for (let cp = 0; cp < nC; cp++) {
      const b8 = cp * 8;
      let ax = 0, ay = 0, az = 0;
      for (let c = 0; c < 8; c++) {
        const n = nodes[b8 + c] * 3, w = wN[b8 + c];
        ax += w * v[n]; ay += w * v[n + 1]; az += w * v[n + 2];
      }
      for (let c = 0; c < 8; c++) {
        const n = nodes[b8 + c] * 3;
        v[n] += (ax - v[n]) * d;
        v[n + 1] += (ay - v[n + 1]) * d;
        v[n + 2] += (az - v[n + 2]) * d;
      }
    }
  }

  // ---- readouts ----

  kineticEnergy() {
    // g·cm²/s² → µJ (1 g·cm²/s² = 0.1 µJ)
    let e = 0;
    const { v } = this;
    const m = this.topo.mass;
    for (let n = 0; n < this.topo.nNodes; n++) e += 0.5 * m[n] * (v[n * 3] ** 2 + v[n * 3 + 1] ** 2 + v[n * 3 + 2] ** 2);
    return e * 0.1;
  }

  totalMass() {
    return this.topo.pieces.reduce((s, p) => s + p.volume, 0) * 1.05;
  }
}
