// Builds the simulation mesh from the fine signed-distance field.
//
// Each coarse cell becomes one hexahedral element per connected blob of jelly inside it ("copies",
// the virtual node algorithm). Copies in neighbouring cells share corner nodes only where their
// jelly actually touches, so a thin cut through a cell splits it into two copies with their own
// nodes, and the two sides move apart freely. Pieces are connected groups of copies.

import { H, R, FINE, ORIGIN, NC, NF, NFN, fineNodeIndex, fineCellIndex, coarseCellIndex } from './sdf.js';

export const DENSITY = 1.05; // g/cm³, set gelatine

const CORNER = [];
for (let c = 0; c < 8; c++) CORNER.push([c & 1, (c >> 1) & 1, (c >> 2) & 1]);
export { CORNER };

// The 8 fine nodes of fine cell (i,j,k), in corner-bit order.
export function fineCellNodes(i, j, k, out) {
  for (let c = 0; c < 8; c++) out[c] = fineNodeIndex(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1));
  return out;
}

// Corners of the face shared with the +axis neighbour, as corner bits on this side.
const FACE_CORNERS = [
  [1, 3, 5, 7], // +x
  [2, 3, 6, 7], // +y
  [4, 5, 6, 7], // +z
];
const AXIS_BIT = [1, 2, 4];

class UnionFind {
  constructor(n) {
    this.p = new Int32Array(n);
    for (let i = 0; i < n; i++) this.p[i] = i;
  }
  find(a) {
    const p = this.p;
    while (p[a] !== a) {
      p[a] = p[p[a]];
      a = p[a];
    }
    return a;
  }
  union(a, b) {
    a = this.find(a);
    b = this.find(b);
    if (a !== b) this.p[b] = a;
  }
}

export function buildTopology(phi) {
  const nFineCells = NF[0] * NF[1] * NF[2];
  const mat = new Uint8Array(nFineCells);
  const nodes8 = new Int32Array(8);

  // 1. which fine cells touch jelly
  for (let i = 0; i < NF[0]; i++)
    for (let j = 0; j < NF[1]; j++)
      for (let k = 0; k < NF[2]; k++) {
        fineCellNodes(i, j, k, nodes8);
        let m = false;
        for (let c = 0; c < 8; c++) if (phi[nodes8[c]] < 0) { m = true; break; }
        if (m) mat[fineCellIndex(i, j, k)] = 1;
      }

  // Two face-adjacent fine cells are joined when their shared face has jelly on it.
  const faceConnected = (i, j, k, axis) => {
    const corners = FACE_CORNERS[axis];
    for (let t = 0; t < 4; t++) {
      const c = corners[t];
      if (phi[fineNodeIndex(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))] < 0) return true;
    }
    return false;
  };

  // 2. copies: connected blobs inside each coarse cell
  const fineCopy = new Int32Array(nFineCells).fill(-1);
  const copyCell = [];
  const copyFirstFine = [];
  const stack = [];
  for (let ci = 0; ci < NC[0]; ci++)
    for (let cj = 0; cj < NC[1]; cj++)
      for (let ck = 0; ck < NC[2]; ck++) {
        const i0 = ci * R, j0 = cj * R, k0 = ck * R;
        for (let a = 0; a < R; a++)
          for (let b = 0; b < R; b++)
            for (let c = 0; c < R; c++) {
              const f = fineCellIndex(i0 + a, j0 + b, k0 + c);
              if (!mat[f] || fineCopy[f] >= 0) continue;
              const id = copyCell.length;
              copyCell.push(coarseCellIndex(ci, cj, ck));
              copyFirstFine.push(f);
              fineCopy[f] = id;
              stack.push(i0 + a, j0 + b, k0 + c);
              while (stack.length) {
                const z = stack.pop(), y = stack.pop(), x = stack.pop();
                for (let axis = 0; axis < 3; axis++) {
                  for (const dir of [-1, 1]) {
                    const nx = x + (axis === 0 ? dir : 0), ny = y + (axis === 1 ? dir : 0), nz = z + (axis === 2 ? dir : 0);
                    if (nx < i0 || ny < j0 || nz < k0 || nx >= i0 + R || ny >= j0 + R || nz >= k0 + R) continue;
                    const g = fineCellIndex(nx, ny, nz);
                    if (!mat[g] || fineCopy[g] >= 0) continue;
                    const ok = dir > 0 ? faceConnected(x, y, z, axis) : faceConnected(nx, ny, nz, axis);
                    if (!ok) continue;
                    fineCopy[g] = id;
                    stack.push(nx, ny, nz);
                  }
                }
              }
            }
      }
  const nCopies = copyCell.length;

  // 3. shared corner nodes between touching copies in neighbouring cells
  const uf = new UnionFind(nCopies * 8);
  for (let i = 0; i < NF[0]; i++)
    for (let j = 0; j < NF[1]; j++)
      for (let k = 0; k < NF[2]; k++) {
        const f = fineCellIndex(i, j, k);
        const a = fineCopy[f];
        if (a < 0) continue;
        const idx = [i, j, k];
        for (let axis = 0; axis < 3; axis++) {
          if ((idx[axis] + 1) % R !== 0 || idx[axis] + 1 >= NF[axis]) continue; // only across coarse boundaries
          const ni = i + (axis === 0), nj = j + (axis === 1), nk = k + (axis === 2);
          const b = fineCopy[fineCellIndex(ni, nj, nk)];
          if (b < 0 || !faceConnected(i, j, k, axis)) continue;
          const bit = AXIS_BIT[axis];
          for (const c of FACE_CORNERS[axis]) uf.union(a * 8 + c, b * 8 + (c & ~bit));
        }
      }

  // 4. compact node ids, rest positions
  const rootToNode = new Int32Array(nCopies * 8).fill(-1);
  const copyNodes = new Int32Array(nCopies * 8);
  const rest = [];
  for (let cp = 0; cp < nCopies; cp++) {
    const cell = copyCell[cp];
    const ci = Math.floor(cell / (NC[1] * NC[2]));
    const cj = Math.floor(cell / NC[2]) % NC[1];
    const ck = cell % NC[2];
    for (let c = 0; c < 8; c++) {
      const r = uf.find(cp * 8 + c);
      if (rootToNode[r] < 0) {
        rootToNode[r] = rest.length / 3;
        rest.push(ORIGIN[0] + (ci + CORNER[c][0]) * H, ORIGIN[1] + (cj + CORNER[c][1]) * H, ORIGIN[2] + (ck + CORNER[c][2]) * H);
      }
      copyNodes[cp * 8 + c] = rootToNode[r];
    }
  }
  const nNodes = rest.length / 3;

  // 5. mass: each fine voxel of jelly spreads its mass over its copy's corners (trilinear)
  const copyW = new Float64Array(nCopies * 8);
  const mass = new Float64Array(nNodes);
  const copyVolume = new Float64Array(nCopies);
  const fineVol = FINE * FINE * FINE;
  for (let i = 0; i < NF[0]; i++)
    for (let j = 0; j < NF[1]; j++)
      for (let k = 0; k < NF[2]; k++) {
        const f = fineCellIndex(i, j, k);
        const cp = fineCopy[f];
        if (cp < 0) continue;
        fineCellNodes(i, j, k, nodes8);
        let neg = 0;
        for (let c = 0; c < 8; c++) if (phi[nodes8[c]] < 0) neg++;
        const vol = (neg / 8) * fineVol;
        copyVolume[cp] += vol;
        const u = ((i % R) + 0.5) / R, v = ((j % R) + 0.5) / R, w = ((k % R) + 0.5) / R;
        for (let c = 0; c < 8; c++) {
          const wt = (CORNER[c][0] ? u : 1 - u) * (CORNER[c][1] ? v : 1 - v) * (CORNER[c][2] ? w : 1 - w);
          copyW[cp * 8 + c] += wt * vol;
        }
      }
  for (let cp = 0; cp < nCopies; cp++) {
    // a little weight on every corner keeps virtual corners attached to their element
    const total = copyVolume[cp];
    for (let c = 0; c < 8; c++) {
      copyW[cp * 8 + c] += total * 0.02;
      mass[copyNodes[cp * 8 + c]] += copyW[cp * 8 + c] * DENSITY;
    }
  }

  // 6. pieces
  const pf = new UnionFind(nCopies);
  const nodeOwner = new Int32Array(nNodes).fill(-1);
  for (let cp = 0; cp < nCopies; cp++)
    for (let c = 0; c < 8; c++) {
      const n = copyNodes[cp * 8 + c];
      if (nodeOwner[n] < 0) nodeOwner[n] = cp;
      else pf.union(nodeOwner[n], cp);
    }
  const rootToPiece = new Map();
  const copyPiece = new Int32Array(nCopies);
  const pieces = [];
  for (let cp = 0; cp < nCopies; cp++) {
    const r = pf.find(cp);
    let id = rootToPiece.get(r);
    if (id === undefined) {
      id = pieces.length;
      rootToPiece.set(r, id);
      pieces.push({ id, copies: [], nodes: [], volume: 0, mass: 0 });
    }
    copyPiece[cp] = id;
    pieces[id].copies.push(cp);
    pieces[id].volume += copyVolume[cp];
  }
  const nodePiece = new Int32Array(nNodes);
  for (let n = 0; n < nNodes; n++) {
    nodePiece[n] = copyPiece[nodeOwner[n]];
    pieces[nodePiece[n]].nodes.push(n);
    pieces[nodePiece[n]].mass += mass[n];
  }

  return {
    nCopies,
    nNodes,
    mat,
    fineCopy,
    copyCell: Int32Array.from(copyCell),
    copyFirstFine: Int32Array.from(copyFirstFine),
    copyNodes,
    copyW,
    copyVolume,
    copyPiece,
    rest: Float64Array.from(rest),
    mass,
    nodePiece,
    pieces,
  };
}

// Coarse cell origin for a copy.
export function copyOrigin(topo, cp) {
  const cell = topo.copyCell[cp];
  const ci = Math.floor(cell / (NC[1] * NC[2]));
  const cj = Math.floor(cell / NC[2]) % NC[1];
  const ck = cell % NC[2];
  return [ORIGIN[0] + ci * H, ORIGIN[1] + cj * H, ORIGIN[2] + ck * H];
}

/**
 * Carry the current deformation over to a rebuilt topology. Cuts only ever remove jelly, so every
 * new copy sits inside exactly one old copy; its corners take that old copy's corner positions.
 */
export function transferState(oldTopo, oldX, oldV, newTopo) {
  const x = new Float64Array(newTopo.nNodes * 3);
  const v = new Float64Array(newTopo.nNodes * 3);
  const done = new Uint8Array(newTopo.nNodes);
  for (let cp = 0; cp < newTopo.nCopies; cp++) {
    const oldCp = oldTopo.fineCopy[newTopo.copyFirstFine[cp]];
    for (let c = 0; c < 8; c++) {
      const n = newTopo.copyNodes[cp * 8 + c];
      if (done[n]) continue;
      done[n] = 1;
      if (oldCp >= 0) {
        const o = oldTopo.copyNodes[oldCp * 8 + c];
        for (let d = 0; d < 3; d++) {
          x[n * 3 + d] = oldX[o * 3 + d];
          v[n * 3 + d] = oldV[o * 3 + d];
        }
      } else {
        for (let d = 0; d < 3; d++) x[n * 3 + d] = newTopo.rest[n * 3 + d];
      }
    }
  }
  return { x, v };
}

// Fine nodes touched by a piece (used to restrict a cut or scoop to that piece only).
export function pieceNodeMask(topo, pieceId) {
  const mask = new Uint8Array(NFN[0] * NFN[1] * NFN[2]);
  const nodes8 = new Int32Array(8);
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < NF[0]; i++)
    for (let j = 0; j < NF[1]; j++)
      for (let k = 0; k < NF[2]; k++) {
        const cp = topo.fineCopy[fineCellIndex(i, j, k)];
        if (cp < 0 || topo.copyPiece[cp] !== pieceId) continue;
        fineCellNodes(i, j, k, nodes8);
        for (let c = 0; c < 8; c++) mask[nodes8[c]] = 1;
        lo = [Math.min(lo[0], i), Math.min(lo[1], j), Math.min(lo[2], k)];
        hi = [Math.max(hi[0], i + 1), Math.max(hi[1], j + 1), Math.max(hi[2], k + 1)];
      }
  return { mask, bounds: [lo, hi] };
}
