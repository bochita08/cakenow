// Rest-space shape of the dessert, stored as signed distances on a fine grid (negative = jelly).
// Units are centimetres. The coarse simulation grid has cells of size H; the fine grid splits each
// coarse cell into R×R×R voxels and carries the actual surface, including every cut and scoop.

import { smoothstep } from './math.js';

export const H = 1.0; // coarse cell size (cm)
export const R = 4; // fine voxels per coarse cell edge
export const FINE = H / R;

// Grid covers x,z in [-9, 9] (dessert + sides on the plate) and y in [0, 9].
export const ORIGIN = [-9, 0, -9];
export const NC = [18, 9, 18]; // coarse cells per axis
export const NF = [NC[0] * R, NC[1] * R, NC[2] * R]; // fine cells per axis
export const NFN = [NF[0] + 1, NF[1] + 1, NF[2] + 1]; // fine nodes per axis

export const JELLY_HEIGHT = 7.0;
export const FLUTES = 12;

export const fineNodeIndex = (i, j, k) => (i * NFN[1] + j) * NFN[2] + k;
export const fineCellIndex = (i, j, k) => (i * NF[1] + j) * NF[2] + k;
export const coarseCellIndex = (i, j, k) => (i * NC[1] + j) * NC[2] + k;

// Classic unmoulded jelly: three fluted tiers stepping in, topped with a rounded crown.
export function mouldRadius(y, theta) {
  let r = 6.05 - 0.12 * y;
  r -= 1.05 * smoothstep(2.45, 3.05, y);
  r -= 1.35 * smoothstep(4.85, 5.45, y);
  const flute = 0.34 * (1 - smoothstep(2.6, 3.0, y)) + 0.26 * smoothstep(2.6, 3.0, y) * (1 - smoothstep(5.0, 5.4, y));
  r += flute * Math.cos(FLUTES * theta);
  if (y > 5.4) {
    const t = Math.min(1, (y - 5.4) / (JELLY_HEIGHT - 5.4));
    r *= Math.sqrt(Math.max(0, 1 - t * t));
  }
  if (y < 0.35) {
    // soft rounded foot where the jelly meets the plate
    const d = 0.35 - y;
    r -= 0.35 - Math.sqrt(Math.max(0, 0.35 * 0.35 - d * d));
  }
  return r;
}

export function mouldSdf(x, y, z) {
  const r = Math.hypot(x, z);
  const theta = Math.atan2(z, x);
  const lateral = r - mouldRadius(Math.max(0, Math.min(JELLY_HEIGHT, y)), theta);
  return Math.max(lateral, 0.05 - y, y - JELLY_HEIGHT);
}

export function finePos(i, j, k) {
  return [ORIGIN[0] + i * FINE, ORIGIN[1] + j * FINE, ORIGIN[2] + k * FINE];
}

export function createField(shapeSdf = mouldSdf) {
  const phi = new Float32Array(NFN[0] * NFN[1] * NFN[2]);
  for (let i = 0; i < NFN[0]; i++) {
    for (let j = 0; j < NFN[1]; j++) {
      for (let k = 0; k < NFN[2]; k++) {
        const p = finePos(i, j, k);
        let d = shapeSdf(p[0], p[1], p[2]);
        // keep the grid border empty so the surface always closes
        if (i === 0 || j === 0 || k === 0 || i === NF[0] || j === NF[1] || k === NF[2]) d = Math.max(d, FINE);
        // nudge exact zeros off the surface: they make degenerate triangles
        if (Math.abs(d) < 1e-4) d = 1e-4;
        phi[fineNodeIndex(i, j, k)] = d;
      }
    }
  }
  return phi;
}

/**
 * Remove material with a primitive: phi = max(phi, -primitive). `nodeMask` (Uint8Array over fine nodes)
 * restricts the edit to nodes that belong to the piece being cut. Returns the number of nodes changed.
 */
export function subtract(phi, nodeMask, primitiveSdf, bounds) {
  const [lo, hi] = bounds || [[0, 0, 0], [NF[0], NF[1], NF[2]]];
  let changed = 0;
  for (let i = Math.max(0, lo[0]); i <= Math.min(NF[0], hi[0]); i++) {
    for (let j = Math.max(0, lo[1]); j <= Math.min(NF[1], hi[1]); j++) {
      for (let k = Math.max(0, lo[2]); k <= Math.min(NF[2], hi[2]); k++) {
        const n = fineNodeIndex(i, j, k);
        if (nodeMask && !nodeMask[n]) continue;
        const p = finePos(i, j, k);
        let d = Math.max(phi[n], -primitiveSdf(p[0], p[1], p[2]));
        if (Math.abs(d) < 1e-4) d = 1e-4;
        if (d !== phi[n]) {
          phi[n] = d;
          changed++;
        }
      }
    }
  }
  return changed;
}

export function slabSdf(point, normal, halfWidth) {
  return (x, y, z) => Math.abs((x - point[0]) * normal[0] + (y - point[1]) * normal[1] + (z - point[2]) * normal[2]) - halfWidth;
}

export function ellipsoidSdf(center, radii) {
  return (x, y, z) => {
    const qx = (x - center[0]) / radii[0], qy = (y - center[1]) / radii[1], qz = (z - center[2]) / radii[2];
    const k = Math.hypot(qx, qy, qz);
    return (k - 1) * Math.min(radii[0], radii[1], radii[2]);
  };
}

// Ingredient map: one byte per small voxel (8 per coarse cell edge), cell-centred, read by the
// renderer to colour any point of the dessert, including fresh cut faces.
export const MR = 8;
export const MCELL = H / MR;
export const MDIM = [NC[0] * MR, NC[1] * MR, NC[2] * MR];

export function createMaterialGrid(materialFn, phi) {
  const out = new Uint8Array(MDIM[0] * MDIM[1] * MDIM[2]);
  const per = MR / R; // material voxels per fine cell edge
  let i = 0;
  // texture layout: x fastest, then y, then z
  for (let z = 0; z < MDIM[2]; z++)
    for (let y = 0; y < MDIM[1]; y++)
      for (let x = 0; x < MDIM[0]; x++, i++) {
        if (phi) {
          // far outside the dessert nothing is ever drawn: skip it
          const fi = Math.floor(x / per), fj = Math.floor(y / per), fk = Math.floor(z / per);
          let m = Infinity;
          for (let c = 0; c < 8; c++) m = Math.min(m, phi[fineNodeIndex(fi + (c & 1), fj + ((c >> 1) & 1), fk + ((c >> 2) & 1))]);
          if (m > 0.35) continue;
        }
        out[i] = materialFn(ORIGIN[0] + (x + 0.5) * MCELL, ORIGIN[1] + (y + 0.5) * MCELL, ORIGIN[2] + (z + 0.5) * MCELL);
      }
  return out;
}

export function materialAt(grid, x, y, z) {
  const ix = Math.min(MDIM[0] - 1, Math.max(0, Math.floor((x - ORIGIN[0]) / MCELL)));
  const iy = Math.min(MDIM[1] - 1, Math.max(0, Math.floor((y - ORIGIN[1]) / MCELL)));
  const iz = Math.min(MDIM[2] - 1, Math.max(0, Math.floor((z - ORIGIN[2]) / MCELL)));
  return grid[(iz * MDIM[1] + iy) * MDIM[0] + ix];
}
