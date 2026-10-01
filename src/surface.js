// Visible surface: marching tetrahedra over the fine field, one closed mesh per copy, with every
// vertex embedded (trilinear weights) in its copy's coarse element so it follows the simulation.

import { H, FINE, ORIGIN, NF, NFN, fineNodeIndex, fineCellIndex } from './sdf.js';
import { fineCellNodes, copyOrigin } from './topology.js';

// Six tetrahedra around the cube diagonal 0→7 (consistent across neighbouring cells).
const KUHN = [
  [0, 1, 3, 7],
  [0, 1, 5, 7],
  [0, 2, 3, 7],
  [0, 2, 6, 7],
  [0, 4, 5, 7],
  [0, 4, 6, 7],
];

/**
 * Marching tetrahedra over the fine cells for which `owner(f)` returns >= 0.
 * Returns rest-space vertices, triangles and per-vertex owner ids.
 */
export function marchTets(phi, owner, cellRange) {
  const verts = [];
  const vOwner = [];
  const vEdge = [];
  const vNorm = [];
  const tris = [];
  const edgeMap = new Map();
  const nodes8 = new Int32Array(8);
  const nNodesTotal = NFN[0] * NFN[1] * NFN[2];
  const pos = (n) => {
    const k = n % NFN[2];
    const j = Math.floor(n / NFN[2]) % NFN[1];
    const i = Math.floor(n / (NFN[1] * NFN[2]));
    return [ORIGIN[0] + i * FINE, ORIGIN[1] + j * FINE, ORIGIN[2] + k * FINE];
  };
  // field gradient at a fine node (central differences), the rest-space outward normal
  const SI = NFN[1] * NFN[2], SJ = NFN[2];
  const grad = (n) => {
    const k = n % NFN[2];
    const j = Math.floor(n / NFN[2]) % NFN[1];
    const i = Math.floor(n / SI);
    const gx = phi[i < NF[0] ? n + SI : n] - phi[i > 0 ? n - SI : n];
    const gy = phi[j < NF[1] ? n + SJ : n] - phi[j > 0 ? n - SJ : n];
    const gz = phi[k < NF[2] ? n + 1 : n] - phi[k > 0 ? n - 1 : n];
    return [gx, gy, gz];
  };
  const vertexOn = (a, b, own) => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const key = (own * nNodesTotal + lo) * nNodesTotal + hi;
    let id = edgeMap.get(key);
    if (id !== undefined) return id;
    const pa = pos(a), pb = pos(b);
    let t = phi[a] / (phi[a] - phi[b]);
    t = Math.min(0.999, Math.max(0.001, t));
    id = vOwner.length;
    verts.push(pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t);
    vOwner.push(own);
    vEdge.push(lo * nNodesTotal + hi);
    const ga = grad(a), gb = grad(b);
    const nx = ga[0] + (gb[0] - ga[0]) * t, ny = ga[1] + (gb[1] - ga[1]) * t, nz = ga[2] + (gb[2] - ga[2]) * t;
    const nl = Math.hypot(nx, ny, nz) || 1;
    vNorm.push(nx / nl, ny / nl, nz / nl);
    edgeMap.set(key, id);
    return id;
  };
  const emit = (a, b, c, insideCentroid, outsideCentroid) => {
    const pa = [verts[a * 3], verts[a * 3 + 1], verts[a * 3 + 2]];
    const pb = [verts[b * 3], verts[b * 3 + 1], verts[b * 3 + 2]];
    const pc = [verts[c * 3], verts[c * 3 + 1], verts[c * 3 + 2]];
    const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const out = [outsideCentroid[0] - insideCentroid[0], outsideCentroid[1] - insideCentroid[1], outsideCentroid[2] - insideCentroid[2]];
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] >= 0) tris.push(a, b, c);
    else tris.push(a, c, b);
  };

  const [lo, hi] = cellRange || [[0, 0, 0], [NF[0], NF[1], NF[2]]];
  for (let i = lo[0]; i < hi[0]; i++)
    for (let j = lo[1]; j < hi[1]; j++)
      for (let k = lo[2]; k < hi[2]; k++) {
        const own = owner(fineCellIndex(i, j, k), i, j, k);
        if (own < 0) continue;
        fineCellNodes(i, j, k, nodes8);
        let neg = 0;
        for (let c = 0; c < 8; c++) if (phi[nodes8[c]] < 0) neg++;
        if (neg === 0 || neg === 8) continue;
        for (const tet of KUHN) {
          const ins = [], outs = [];
          for (const c of tet) (phi[nodes8[c]] < 0 ? ins : outs).push(nodes8[c]);
          if (ins.length === 0 || ins.length === 4) continue;
          const centroid = (list) => {
            const s = [0, 0, 0];
            for (const n of list) {
              const p = pos(n);
              s[0] += p[0]; s[1] += p[1]; s[2] += p[2];
            }
            return [s[0] / list.length, s[1] / list.length, s[2] / list.length];
          };
          const ci = centroid(ins), co = centroid(outs);
          if (ins.length === 1 || ins.length === 3) {
            const single = ins.length === 1 ? ins[0] : outs[0];
            const others = ins.length === 1 ? outs : ins;
            emit(vertexOn(single, others[0], own), vertexOn(single, others[1], own), vertexOn(single, others[2], own), ci, co);
          } else {
            const [a, b] = ins, [c, d] = outs;
            const v0 = vertexOn(a, c, own), v1 = vertexOn(a, d, own), v2 = vertexOn(b, d, own), v3 = vertexOn(b, c, own);
            emit(v0, v1, v2, ci, co);
            emit(v0, v2, v3, ci, co);
          }
        }
      }
  return { verts: Float32Array.from(verts), owner: Int32Array.from(vOwner), edge: Float64Array.from(vEdge), normals: Float32Array.from(vNorm), tris: Uint32Array.from(tris) };
}

/** Surface of the whole dessert, embedded in the simulation elements. */
export function buildSurface(phi, topo) {
  const m = marchTets(phi, (f) => topo.fineCopy[f]);
  const nv = m.owner.length;
  const vNodes = new Int32Array(nv * 8);
  const vW = new Float32Array(nv * 8);
  const vPiece = new Int32Array(nv);
  const origins = new Map();
  for (let v = 0; v < nv; v++) {
    const cp = m.owner[v];
    let o = origins.get(cp);
    if (!o) {
      o = copyOrigin(topo, cp);
      origins.set(cp, o);
    }
    const u = Math.min(1, Math.max(0, (m.verts[v * 3] - o[0]) / H));
    const s = Math.min(1, Math.max(0, (m.verts[v * 3 + 1] - o[1]) / H));
    const w = Math.min(1, Math.max(0, (m.verts[v * 3 + 2] - o[2]) / H));
    for (let c = 0; c < 8; c++) {
      vNodes[v * 8 + c] = topo.copyNodes[cp * 8 + c];
      vW[v * 8 + c] = (c & 1 ? u : 1 - u) * ((c >> 1) & 1 ? s : 1 - s) * ((c >> 2) & 1 ? w : 1 - w);
    }
    vPiece[v] = topo.copyPiece[cp];
  }

  // Vertices duplicated across neighbouring elements of one piece are welded for smooth normals.
  const weld = new Int32Array(nv);
  const firstOnEdge = new Map();
  for (let v = 0; v < nv; v++) {
    const key = m.edge[v] * 4096 + vPiece[v];
    const w = firstOnEdge.get(key);
    weld[v] = w === undefined ? v : w;
    if (w === undefined) firstOnEdge.set(key, v);
  }

  // Collision probes: about one surface vertex per 0.55 cm bucket, per piece.
  const probes = [];
  const seen = new Set();
  const B = 0.55;
  for (let v = 0; v < nv; v++) {
    const key = `${vPiece[v]}:${Math.floor(m.verts[v * 3] / B)}:${Math.floor(m.verts[v * 3 + 1] / B)}:${Math.floor(m.verts[v * 3 + 2] / B)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    probes.push(v);
  }

  return { rest: m.verts, restNormals: m.normals, tris: m.tris, vNodes, vW, vPiece, weld, probes: Int32Array.from(probes), nVerts: nv };
}

/** Skin surface vertices from node positions x into out (Float32Array nv*3). */
export function skin(surf, x, out) {
  const { vNodes, vW, nVerts } = surf;
  for (let v = 0; v < nVerts; v++) {
    let px = 0, py = 0, pz = 0;
    const b = v * 8;
    for (let c = 0; c < 8; c++) {
      const w = vW[b + c];
      if (w === 0) continue;
      const n = vNodes[b + c] * 3;
      px += w * x[n];
      py += w * x[n + 1];
      pz += w * x[n + 2];
    }
    out[v * 3] = px;
    out[v * 3 + 1] = py;
    out[v * 3 + 2] = pz;
  }
  return out;
}

export function computeNormals(pos, tris, nVerts, weld, out) {
  out.fill(0, 0, nVerts * 3);
  for (let t = 0; t < tris.length; t += 3) {
    const ia = tris[t] * 3, ib = tris[t + 1] * 3, ic = tris[t + 2] * 3;
    const a = weld[tris[t]] * 3, b = weld[tris[t + 1]] * 3, c = weld[tris[t + 2]] * 3;
    const e1x = pos[ib] - pos[ia], e1y = pos[ib + 1] - pos[ia + 1], e1z = pos[ib + 2] - pos[ia + 2];
    const e2x = pos[ic] - pos[ia], e2y = pos[ic + 1] - pos[ia + 1], e2z = pos[ic + 2] - pos[ia + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    out[a] += nx; out[a + 1] += ny; out[a + 2] += nz;
    out[b] += nx; out[b + 1] += ny; out[b + 2] += nz;
    out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
  }
  for (let v = 0; v < nVerts; v++) {
    if (weld[v] !== v) continue;
    const i = v * 3;
    const l = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1;
    out[i] /= l; out[i + 1] /= l; out[i + 2] /= l;
  }
  for (let v = 0; v < nVerts; v++) {
    const w = weld[v];
    if (w === v) continue;
    out[v * 3] = out[w * 3]; out[v * 3 + 1] = out[w * 3 + 1]; out[v * 3 + 2] = out[w * 3 + 2];
  }
  return out;
}

/** Signed volume enclosed by the mesh (divergence theorem). */
export function meshVolume(pos, tris) {
  let v = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    v += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
      - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
      + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  return v / 6;
}
