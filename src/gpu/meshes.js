// Static meshes: interleaved [px, py, pz, nx, ny, nz] + uint32 indices.

import { PLATE } from '../sim.js';

function lathe(profile, segments) {
  // profile: [[r, y], ...] top to bottom; normals from the profile tangent
  const verts = [];
  const idx = [];
  const n = profile.length;
  const pn = profile.map((p, i) => {
    const a = profile[Math.max(0, i - 1)], b = profile[Math.min(n - 1, i + 1)];
    const tr = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tr, ty) || 1;
    return [-ty / l, tr / l]; // tangent rotated: up for a profile walking outwards along the top
  });
  for (let s = 0; s <= segments; s++) {
    const t = (s / segments) * Math.PI * 2;
    const c = Math.cos(t), si = Math.sin(t);
    for (let i = 0; i < n; i++) {
      const [r, y] = profile[i];
      const [nr, ny] = pn[i];
      verts.push(r * c, y, r * si, nr * c, ny, nr * si);
    }
  }
  for (let s = 0; s < segments; s++)
    for (let i = 0; i < n - 1; i++) {
      const a = s * n + i, b = (s + 1) * n + i;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  return { verts: new Float32Array(verts), idx: new Uint32Array(idx) };
}

export function plateMesh() {
  const p = [];
  // top surface from centre outwards (normals point up)
  p.push([0, 0]);
  for (let r = 1; r <= PLATE.flat; r += 1.2) p.push([Math.min(r, PLATE.flat), 0]);
  p.push([PLATE.flat, 0]);
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    const r = PLATE.flat + (PLATE.rim - PLATE.flat) * t;
    p.push([r, PLATE.rimHeight * t * t]);
  }
  p.push([PLATE.lip - 0.2, PLATE.rimHeight]);
  // rounded lip
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI / 2 - (i / 6) * Math.PI;
    p.push([PLATE.lip - 0.2 + Math.cos(a) * 0.22, PLATE.rimHeight - 0.22 + Math.sin(a) * 0.22]);
  }
  // underside back toward the foot ring
  p.push([PLATE.rim - 0.4, 0.15]);
  p.push([8.2, -1.05]);
  p.push([7.6, -1.45]);
  p.push([6.9, -1.45]);
  p.push([6.6, -1.2]);
  p.push([0, -1.2]);
  return lathe(p, 120);
}

export function tableMesh() {
  const s = 260, y = PLATE.table;
  return {
    verts: new Float32Array([-s, y, -s, 0, 1, 0, s, y, -s, 0, 1, 0, s, y, s, 0, 1, 0, -s, y, s, 0, 1, 0]),
    idx: new Uint32Array([0, 2, 1, 0, 3, 2]),
  };
}

function box(out, idx, cx, cy, cz, sx, sy, sz, taperTop = 1) {
  // axis-aligned box centred at c with half sizes s; taperTop narrows the z thickness at the top (a blade edge)
  const base = out.length / 6;
  const faces = [
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
    [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
    [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
  ];
  let f = 0;
  for (const [n, corners] of faces) {
    for (const c of corners) {
      const zz = c[1] > 0 ? c[2] * taperTop : c[2];
      out.push(cx + c[0] * sx, cy + c[1] * sy, cz + zz * sz, n[0], n[1], n[2]);
    }
    const b = base + f * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    f++;
  }
}

// Knife in its own frame: blade along +x, edge at y = 0, flat faces along ±z.
export function knifeMeshes() {
  const bv = [], bi = [];
  // blade: thin at the edge (bottom), thicker spine (top)
  const L = 13, Hh = 3.0;
  const prof = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const x = -L / 2 + t * L;
    // edge curves up toward the tip
    const yEdge = t > 0.72 ? Math.pow((t - 0.72) / 0.28, 2) * 1.6 : 0;
    const yTop = Hh - (t > 0.82 ? Math.pow((t - 0.82) / 0.18, 1.5) * 1.2 : 0);
    prof.push([x, yEdge, yTop]);
  }
  // three strips with their own normals: left flat, right flat, spine
  const strip = (side) => {
    const base = bv.length / 6;
    for (const [x, y0, y1] of prof) {
      if (side === 0) {
        bv.push(x, y1, -0.07, 0, 1, 0, x, y1, 0.07, 0, 1, 0);
      } else {
        const nz = side * 0.999, ny = -0.045;
        bv.push(x, y0, 0, 0, ny, nz, x, y1, 0.07 * side, 0, ny, nz);
      }
    }
    for (let i = 0; i < prof.length - 1; i++) {
      const a = base + i * 2, b = base + (i + 1) * 2;
      bi.push(a, b, a + 1, b, b + 1, a + 1);
    }
  };
  strip(-1);
  strip(1);
  strip(0);
  const hv = [], hi = [];
  box(hv, hi, -L / 2 - 3.1, 1.75, 0, 3.1, 0.75, 0.55);
  // rivets
  for (const dx of [-1.6, 0, 1.6]) box(hv, hi, -L / 2 - 3.1 + dx, 1.75, 0, 0.17, 0.17, 0.58);
  return {
    blade: { verts: new Float32Array(bv), idx: new Uint32Array(bi) },
    handle: { verts: new Float32Array(hv), idx: new Uint32Array(hi) },
  };
}

// Spoon in its own frame: bowl centred at the origin opening upward (+y), handle along −x.
export function spoonMesh() {
  const v = [], idx = [];
  const rx = 1.9, rz = 1.35, depth = 0.95;
  const rings = 12, segs = 28;
  // bowl: outer and inner shells of a scaled half ellipsoid
  for (const side of [1, -1]) {
    const base = v.length / 6;
    for (let r = 0; r <= rings; r++) {
      const phi = (r / rings) * (Math.PI / 2);
      for (let s = 0; s <= segs; s++) {
        const th = (s / segs) * Math.PI * 2;
        const sx = Math.sin(phi) * Math.cos(th), sz = Math.sin(phi) * Math.sin(th), sy = -Math.cos(phi);
        const off = side < 0 ? 0.06 : 0;
        const px = sx * (rx - off), pz = sz * (rz - off), py = sy * (depth - off) + depth;
        let nx = sx / rx, ny = sy / depth, nz = sz / rz;
        const l = Math.hypot(nx, ny, nz);
        nx /= l; ny /= l; nz /= l;
        v.push(px, py, pz, nx * side, ny * side, nz * side);
      }
    }
    for (let r = 0; r < rings; r++)
      for (let s = 0; s < segs; s++) {
        const a = base + r * (segs + 1) + s, b = a + segs + 1;
        if (side > 0) idx.push(a, b, a + 1, b, b + 1, a + 1);
        else idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
  }
  box(v, idx, -rx - 3.6, depth + 0.35, 0, 3.8, 0.08, 0.32);
  return { verts: new Float32Array(v), idx: new Uint32Array(idx) };
}

// A crumb: an irregular little chunk with flat faces (unit size, scaled per instance).
export function crumbMesh() {
  const base = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const jitter = [1.0, 0.8, 0.7, 1.1, 0.9, 0.75];
  const p = base.map((v, i) => v.map((c) => c * jitter[i] * 0.5));
  const faces = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]];
  const verts = [], idx = [];
  for (const [a, b, c] of faces) {
    const A = p[a], B = p[b], C = p[c];
    const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...n);
    n = n.map((v) => v / l);
    const centre = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
    const out = n[0] * centre[0] + n[1] * centre[1] + n[2] * centre[2] >= 0;
    if (!out) n = n.map((v) => -v);
    const b0 = verts.length / 6;
    for (const q of out ? [A, B, C] : [A, C, B]) verts.push(...q, ...n);
    idx.push(b0, b0 + 1, b0 + 2);
  }
  return { verts: new Float32Array(verts), idx: new Uint32Array(idx) };
}
