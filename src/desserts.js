// The desserts on the plate. Each one is a rest-space shape (signed distance, cm, base on y = 0)
// plus a material function that says which ingredient fills each point: layers, crusts, tops.
// Toppings (dulce de leche, crema) are caps grown on whatever faces up.

import { smoothstep, clamp } from './math.js';
import { mouldSdf } from './sdf.js';

// ---------- ingredients ----------
// albedo/tint are sRGB; translucency 0 = opaque … 1 = clear jelly; density = how fast light is
// absorbed; scatter = soft milky light; grain = crumb/porosity texture; stiff = firmness multiplier;
// crumbly = sheds crumbs when cut or scooped.
const M = {
  custard: { name: 'Flan', albedo: [0.95, 0.76, 0.34], tint: [0.98, 0.72, 0.25], translucency: 0.4, density: 0.9, rough: 0.12, scatter: 0.55, grain: 0.04, grainScale: 3, stiff: 0.9 },
  caramel: { name: 'Caramelo', albedo: [0.55, 0.22, 0.05], tint: [0.75, 0.33, 0.06], translucency: 0.75, density: 1.6, rough: 0.05, scatter: 0.1, grain: 0, grainScale: 1, stiff: 0.6 },
  ddl: { name: 'Dulce de leche', albedo: [0.55, 0.29, 0.11], tint: [0.66, 0.35, 0.12], translucency: 0.3, density: 2.4, rough: 0.1, scatter: 0.3, grain: 0.02, grainScale: 2, stiff: 0.3 },
  crema: { name: 'Crema batida', albedo: [0.99, 0.97, 0.93], tint: [1, 1, 1], translucency: 0, density: 1, rough: 0.6, scatter: 0.7, grain: 0.08, grainScale: 7, stiff: 0.35 },
  masa: { name: 'Masa de rogel', albedo: [0.89, 0.7, 0.42], tint: [1, 1, 1], translucency: 0, density: 1, rough: 0.72, scatter: 0.15, grain: 0.4, grainScale: 9, stiff: 1.7, crumbly: true },
  merengue: { name: 'Merengue', albedo: [0.98, 0.95, 0.9], tint: [1, 1, 1], translucency: 0, density: 1, rough: 0.6, scatter: 0.6, grain: 0.06, grainScale: 5, stiff: 0.28 },
  merengueTostado: { name: 'Merengue tostado', albedo: [0.83, 0.6, 0.35], tint: [1, 1, 1], translucency: 0, density: 1, rough: 0.55, scatter: 0.35, grain: 0.25, grainScale: 6, stiff: 0.32, crumbly: true },
  vainilla: { name: 'Vainillas con café', albedo: [0.66, 0.45, 0.25], tint: [1, 1, 1], translucency: 0, density: 1, rough: 0.8, scatter: 0.2, grain: 0.35, grainScale: 7, stiff: 0.5 },
  mascarpone: { name: 'Mascarpone', albedo: [0.96, 0.92, 0.82], tint: [1, 1, 1], translucency: 0, density: 1, rough: 0.5, scatter: 0.55, grain: 0.04, grainScale: 4, stiff: 0.3 },
  cacao: { name: 'Cacao', albedo: [0.33, 0.19, 0.12], tint: [1, 1, 1], translucency: 0, density: 1, rough: 0.95, scatter: 0.05, grain: 0.35, grainScale: 16, stiff: 0.3, crumbly: true },
  chocolina: { name: 'Chocolinas', albedo: [0.24, 0.14, 0.09], tint: [1, 1, 1], translucency: 0, density: 1, rough: 0.7, scatter: 0.1, grain: 0.25, grainScale: 8, stiff: 0.65 },
  cremaChoco: { name: 'Dulce de leche con queso', albedo: [0.85, 0.7, 0.53], tint: [1, 1, 1], translucency: 0, density: 1, rough: 0.45, scatter: 0.4, grain: 0.04, grainScale: 4, stiff: 0.3 },
  migas: { name: 'Migas de galletita', albedo: [0.22, 0.13, 0.08], tint: [1, 1, 1], translucency: 0, density: 1, rough: 0.9, scatter: 0.05, grain: 0.6, grainScale: 11, stiff: 0.5, crumbly: true },
  baseGalleta: { name: 'Base de galletitas', albedo: [0.78, 0.55, 0.3], tint: [1, 1, 1], translucency: 0, density: 1, rough: 0.85, scatter: 0.1, grain: 0.5, grainScale: 10, stiff: 1.4, crumbly: true },
  queso: { name: 'Queso crema', albedo: [0.97, 0.92, 0.79], tint: [1, 1, 1], translucency: 0, density: 1, rough: 0.42, scatter: 0.55, grain: 0.03, grainScale: 3, stiff: 0.6 },
  coulis: { name: 'Frutos rojos', albedo: [0.5, 0.03, 0.12], tint: [0.66, 0.04, 0.16], translucency: 0.8, density: 1.8, rough: 0.05, scatter: 0.1, grain: 0.1, grainScale: 3, stiff: 0.4 },
  curd: { name: 'Crema de limón', albedo: [1.0, 0.85, 0.22], tint: [1.0, 0.84, 0.12], translucency: 0.45, density: 1.0, rough: 0.1, scatter: 0.45, grain: 0.02, grainScale: 3, stiff: 0.45 },
  pastry: { name: 'Masa sablée', albedo: [0.85, 0.62, 0.36], tint: [1, 1, 1], translucency: 0, density: 1, rough: 0.8, scatter: 0.12, grain: 0.4, grainScale: 9, stiff: 1.5, crumbly: true },
  budin: { name: 'Budín de pan', albedo: [0.72, 0.47, 0.24], tint: [1, 1, 1], translucency: 0, density: 1, rough: 0.6, scatter: 0.25, grain: 0.5, grainScale: 4.5, stiff: 0.7 },
  marquise: { name: 'Chocolate', albedo: [0.2, 0.1, 0.06], tint: [1, 1, 1], translucency: 0, density: 1, rough: 0.28, scatter: 0.12, grain: 0.03, grainScale: 3, stiff: 0.85 },
  brownie: { name: 'Brownie', albedo: [0.25, 0.13, 0.07], tint: [1, 1, 1], translucency: 0, density: 1, rough: 0.7, scatter: 0.1, grain: 0.35, grainScale: 6, stiff: 1.1, crumbly: true },
  brownieTop: { name: 'Costra de brownie', albedo: [0.32, 0.18, 0.1], tint: [1, 1, 1], translucency: 0, density: 1, rough: 0.35, scatter: 0.05, grain: 0.5, grainScale: 5, stiff: 1.2, crumbly: true },
  helado: { name: 'Helado de vainilla', albedo: [0.99, 0.95, 0.85], tint: [1, 1, 1], translucency: 0, density: 1, rough: 0.6, scatter: 0.65, grain: 0.12, grainScale: 4, stiff: 0.35 },
};

export const JELLY_FLAVORS = {
  frutilla: { name: 'Frutilla', tint: [0.93, 0.05, 0.2], density: 0.6, translucency: 1, scatter: 0 },
  limon: { name: 'Limón', tint: [0.78, 0.9, 0.12], density: 0.5, translucency: 1, scatter: 0 },
  naranja: { name: 'Naranja', tint: [1.0, 0.5, 0.06], density: 0.55, translucency: 1, scatter: 0 },
  leche: { name: 'Leche', tint: [0.97, 0.93, 0.86], density: 0.5, translucency: 0.15, scatter: 0.8 },
};

export function jellyMaterial(flavor) {
  const f = JELLY_FLAVORS[flavor] || JELLY_FLAVORS.frutilla;
  return {
    name: `Gelatina de ${f.name.toLowerCase()}`,
    albedo: f.tint,
    tint: f.tint,
    translucency: f.translucency,
    density: f.density,
    rough: 0.05,
    scatter: f.scatter,
    grain: 0,
    grainScale: 1,
    stiff: 1,
  };
}

// ---------- shape helpers ----------
const FOOT = 0.05; // shapes start just above the plate

function roundedCylinder(x, y, z, r, h, round = 0.4) {
  const dr = Math.hypot(x, z) - (r - round);
  const dy = Math.abs(y - (FOOT + h / 2)) - (h / 2 - round);
  return Math.min(Math.max(dr, dy), 0) + Math.hypot(Math.max(dr, 0), Math.max(dy, 0)) - round;
}

function roundedBox(x, y, z, hx, h, hz, round = 0.4) {
  const qx = Math.abs(x) - (hx - round);
  const qy = Math.abs(y - (FOOT + h / 2)) - (h / 2 - round);
  const qz = Math.abs(z) - (hz - round);
  const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
  return out + Math.min(Math.max(qx, qy, qz), 0) - round;
}

const smin = (a, b, k) => {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
};

// Meringue peaks: soft, irregular swirls.
const peaks = (x, z) => 0.5 + 0.5 * Math.sin(2.1 * x + 0.7 * Math.sin(1.3 * z)) * Math.sin(2.3 * z + 0.6 * Math.cos(1.7 * x));

// ---------- the desserts ----------
// Each: id, name, materials (list of ingredient keys), sdf(x,y,z), material(x,y,z) → index into materials,
// feel: default firmness/damping for the sliders.

export const DESSERTS = [
  {
    id: 'gelatina',
    name: 'Gelatina',
    materials: ['jelly'],
    feel: { firmness: 0.45, damping: 0.45 },
    sdf: (x, y, z) => mouldSdf(x, y, z),
    material: () => 0,
  },
  {
    id: 'flan',
    name: 'Flan',
    materials: ['custard', 'caramel'],
    feel: { firmness: 0.5, damping: 0.5 },
    sdf: (x, y, z) => {
      const h = 3.5;
      const r = 5.0 - 0.45 * clamp(y / h, 0, 1);
      const dr = Math.hypot(x, z) - (r - 0.5);
      const dy = Math.abs(y - (FOOT + h / 2)) - (h / 2 - 0.5);
      return Math.min(Math.max(dr, dy), 0) + Math.hypot(Math.max(dr, 0), Math.max(dy, 0)) - 0.5;
    },
    material: (x, y) => (y > 3.15 ? 1 : 0),
  },
  {
    id: 'rogel',
    name: 'Rogel',
    materials: ['masa', 'ddl', 'merengue', 'merengueTostado'],
    feel: { firmness: 0.92, damping: 0.85 },
    sdf: (x, y, z) => {
      const top = 6.0 + 0.55 * peaks(x, z) * smoothstep(5.2, 3.5, Math.hypot(x, z));
      const body = roundedCylinder(x, y, z, 5.2, 9, 0.25);
      return Math.max(body, y - top);
    },
    material: (x, y, z) => {
      if (y < 5.0) {
        const t = (y - FOOT) % 0.62;
        return t < 0.34 ? 0 : 1;
      }
      const top = 6.0 + 0.55 * peaks(x, z) * smoothstep(5.2, 3.5, Math.hypot(x, z));
      return y > top - 0.28 ? 3 : 2;
    },
  },
  {
    id: 'tiramisu',
    name: 'Tiramisú',
    materials: ['vainilla', 'mascarpone', 'cacao'],
    feel: { firmness: 0.55, damping: 0.85 },
    sdf: (x, y, z) => roundedBox(x, y, z, 4.6, 4.8, 4.6, 0.35),
    material: (x, y) => {
      if (y > 4.62) return 2;
      if (y < 1.25 || (y > 2.35 && y < 3.5)) return 0;
      return 1;
    },
  },
  {
    id: 'chocotorta',
    name: 'Chocotorta',
    materials: ['chocolina', 'cremaChoco', 'migas'],
    feel: { firmness: 0.6, damping: 0.85 },
    sdf: (x, y, z) => {
      const bumps = 0.12 * Math.sin(5.1 * x) * Math.sin(4.7 * z);
      return Math.max(roundedBox(x, y, z, 5.4, 6, 3.8, 0.3), y - (4.35 + bumps));
    },
    material: (x, y) => {
      if (y > 4.05) return 2;
      return (y - FOOT) % 0.9 < 0.36 ? 0 : 1;
    },
  },
  {
    id: 'cheesecake',
    name: 'Cheesecake',
    materials: ['baseGalleta', 'queso', 'coulis'],
    feel: { firmness: 0.72, damping: 0.8 },
    sdf: (x, y, z) => roundedCylinder(x, y, z, 5.4, 4.4, 0.3),
    material: (x, y) => (y < 0.75 ? 0 : y > 4.0 ? 2 : 1),
  },
  {
    id: 'lemonpie',
    name: 'Lemon pie',
    materials: ['pastry', 'curd', 'merengue', 'merengueTostado'],
    feel: { firmness: 0.75, damping: 0.8 },
    sdf: (x, y, z) => {
      const r = Math.hypot(x, z);
      const top = 3.6 + 1.0 * (1 - Math.pow(Math.min(1, r / 5.6), 2)) + 0.5 * peaks(x * 1.2, z * 1.2) * smoothstep(5.4, 3.6, r);
      return Math.max(roundedCylinder(x, y, z, 5.6, 9, 0.25), y - top);
    },
    material: (x, y, z) => {
      const r = Math.hypot(x, z);
      if (y < 0.6 || (r > 5.05 && y < 2.75)) return 0;
      if (y < 2.6) return 1;
      const top = 3.6 + 1.0 * (1 - Math.pow(Math.min(1, r / 5.6), 2)) + 0.5 * peaks(x * 1.2, z * 1.2) * smoothstep(5.4, 3.6, r);
      return y > top - 0.3 ? 3 : 2;
    },
  },
  {
    id: 'budin',
    name: 'Budín de pan',
    materials: ['budin', 'caramel'],
    feel: { firmness: 0.7, damping: 0.8 },
    sdf: (x, y, z) => {
      const dome = 0.5 * (1 - Math.pow(x / 5.6, 2));
      return Math.max(roundedBox(x, y, z, 5.6, 6, 3.1, 0.5), y - (3.9 + dome));
    },
    material: (x, y) => (y > 3.55 + 0.5 * (1 - Math.pow(x / 5.6, 2)) ? 1 : 0),
  },
  {
    id: 'marquise',
    name: 'Marquise',
    materials: ['marquise'],
    feel: { firmness: 0.78, damping: 0.8 },
    sdf: (x, y, z) => roundedBox(x, y, z, 5.2, 3.2, 3.4, 0.22),
    material: () => 0,
  },
  {
    id: 'brownie',
    name: 'Brownie con helado',
    materials: ['brownie', 'brownieTop', 'helado'],
    feel: { firmness: 0.9, damping: 0.9 },
    sdf: (x, y, z) => {
      const crack = 0.06 * Math.sin(6.3 * x + 2 * Math.sin(3 * z)) * Math.sin(5.7 * z);
      const brownie = Math.max(roundedBox(x, y, z, 3.8, 3, 3.8, 0.25), y - (2.65 + crack));
      const scoop = Math.hypot(x - 0.3, (y - 4.3) * 1.08, z + 0.2) - 2.3 + 0.08 * Math.sin(7 * x) * Math.sin(6 * z);
      return smin(brownie, scoop, 0.5);
    },
    material: (x, y, z) => {
      const scoop = Math.hypot(x - 0.3, (y - 4.3) * 1.08, z + 0.2) - 2.3;
      if (scoop < 0.15 && y > 2.3) return 2;
      return y > 2.4 ? 1 : 0;
    },
  },
];

export const dessertById = (id) => DESSERTS.find((d) => d.id === id) || DESSERTS[0];

// Sides served on the plate, in front of the dessert: a piped rosette of whipped cream and a
// glossy spoonful of dulce de leche. They are separate pieces, so they wobble on their own.
const CREAM_AT = [6.9, 0, 4.5];
const DDL_AT = [3.0, 0, 7.4];

function creamRosette(x, y, z) {
  const px = x - CREAM_AT[0], pz = z - CREAM_AT[2];
  const r = Math.hypot(px, pz);
  const th = Math.atan2(pz, px);
  const H = 2.6;
  const t = clamp(y / H, 0, 1);
  // piped star: eight ridges twisting up into a curled tip
  const ridges = 0.22 * (1 - t * 0.7) * Math.cos(8 * th + 5.5 * t);
  const prof = 1.5 * Math.pow(1 - t, 0.85) + ridges + 0.12 * Math.sin(t * 9.0) * (1 - t);
  return Math.max((r - prof) * 0.75, FOOT - y, y - H);
}

function ddlDollop(x, y, z) {
  const px = x - DDL_AT[0], pz = z - DDL_AT[2];
  // a flattened, slightly lopsided spoonful with a soft peak where the spoon lifted off
  const body = Math.hypot(px / 1.6, (y - 0.55) / 0.62, pz / 1.2) - 1;
  const peak = Math.hypot(px + 0.5, y - 1.05, pz - 0.2) - 0.42;
  return Math.max(smin(body * 0.62, peak, 0.45), FOOT - y);
}

export const TOPPINGS = {
  ddl: { name: 'Dulce de leche', sdf: ddlDollop },
  crema: { name: 'Crema', sdf: creamRosette },
};

/**
 * Full rest-space description of what's on the plate: shape, ingredient list (≤ 8) and
 * a material index per point. Sides sit on the plate next to the dessert.
 */
export function composeDessert(id, toppings = [], flavor = 'frutilla') {
  const d = dessertById(id);
  const materials = d.materials.map((k) => (k === 'jelly' ? jellyMaterial(flavor) : M[k]));
  const parts = [{ sdf: d.sdf, mat: (x, y, z) => d.material(x, y, z) }];
  for (const t of ['ddl', 'crema']) {
    if (!toppings.includes(t)) continue;
    const idx = materials.length;
    materials.push(M[t]);
    parts.push({ sdf: TOPPINGS[t].sdf, mat: () => idx });
  }
  const shape = (x, y, z) => {
    let v = Infinity;
    for (const p of parts) v = Math.min(v, p.sdf(x, y, z));
    return v;
  };
  // Which ingredient: the part you're inside (or nearest to, just outside the surface).
  const material = (x, y, z) => {
    let best = parts[0], bd = Infinity;
    for (const p of parts) {
      const v = p.sdf(x, y, z);
      if (v < bd) { bd = v; best = p; }
    }
    return best.mat(x, y, z);
  };
  return { id: d.id, name: d.name, feel: d.feel, materials, sdf: shape, material, toppings: [...toppings], flavor };
}

export { M as INGREDIENTS };
