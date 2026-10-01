// The interactive jelly on the home screen: renderer + physics worker + the four tools.

import { createRenderer } from './gpu/renderer.js';
import { fromBasis, normalize, cross, sub, add, scale, dot, lerp, clamp, mul, invert } from './math.js';
import { groundAt } from './sim.js';
import { jellyMaterial } from './desserts.js';
import { materialAt } from './sdf.js';
import { Crumbs } from './crumbs.js';
import { srgbToLinear } from './gpu/renderer.js';
import { spoonMesh } from './gpu/meshes.js';

// points on the spoon (its own frame) that must stay above the plate: a sample of its real vertices
const SPOON_PROBES = (() => {
  const v = spoonMesh().verts;
  const out = [];
  for (let i = 0; i < v.length / 6; i += 3) out.push([v[i * 6], v[i * 6 + 1], v[i * 6 + 2]]);
  return out;
})();

export const FLAVORS = {
  frutilla: { name: 'Frutilla', tint: [0.93, 0.05, 0.2], milk: 0, density: 0.6, accent: '#d4124a' },
  limon: { name: 'Limón', tint: [0.78, 0.9, 0.12], milk: 0, density: 0.5, accent: '#7a9a00' },
  naranja: { name: 'Naranja', tint: [1.0, 0.5, 0.06], milk: 0, density: 0.55, accent: '#e2620b' },
  leche: { name: 'Leche', tint: [0.97, 0.93, 0.86], milk: 0.82, density: 0.5, accent: '#a3794c' },
};

const TOOL_HINTS = {
  hand: '',
  knife: '',
  spoon: 'Tocá la gelatina para sacar una cucharada.',
  tap: 'Tocá la gelatina para darle un golpecito, o el plato para sacudirlo.',
};

function createWorker() {
  // eslint-disable-next-line no-undef
  if (typeof __WORKER_SRC__ !== 'undefined') {
    // eslint-disable-next-line no-undef
    const blob = new Blob([__WORKER_SRC__], { type: 'text/javascript' });
    return new Worker(URL.createObjectURL(blob));
  }
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
}

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeIn = (t) => t * t * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function translate(m, t) {
  const o = new Float32Array(m);
  o[12] += t[0]; o[13] += t[1]; o[14] += t[2];
  return o;
}

export class JellyApp {
  constructor(opts) {
    this.canvas = opts.canvas;
    this.stage = opts.stage;
    this.onStats = opts.onStats || (() => {});
    this.onEvent = opts.onEvent || (() => {});
    this.tool = 'hand';
    this.flavorKey = 'frutilla';
    this.params = { firmness: 0.45, damping: 0.45, timeScale: 1 };
    this.mesh = null;
    this.x = null;
    this.version = 0;
    this.visible = true;
    this.hover = null;
    this.knife = { phase: 'idle', a: null, b: null, dir: [1, 0, 0], t0: 0, cutSent: false };
    this.spoon = { phase: 'idle', pos: null, normal: [0, 1, 0], t0: 0, blob: null };
    this.counts = { cuts: 0, scoops: 0 };
    this.dessert = null;
    this.toppings = [];
    this.crumbs = new Crumbs();
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  async start() {
    this.renderer = await createRenderer(this.canvas);
    this.renderer.onLost = () => this.onEvent({ type: 'fatal', reason: 'gpu-lost' });
    this.worker = createWorker();
    this.worker.onmessage = (e) => this.onWorker(e.data);
    this.worker.onerror = (e) => {
      console.warn('Physics worker error:', e.message);
      this.onEvent({ type: 'fatal', reason: 'worker' });
    };
    this.sendParams();
    this.setFlavor(this.flavorKey);
    this.bindPointer();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(this.stage);
    const io = new IntersectionObserver((entries) => {
      this.visible = entries[0].isIntersecting;
      this.syncPause();
    }, { threshold: 0.02 });
    io.observe(this.stage);
    document.addEventListener('visibilitychange', () => this.syncPause());
    const loop = (t) => {
      requestAnimationFrame(loop);
      if (!this.visible || document.hidden || this.dead) {
        this.lastFrame = 0; // don't count the pause as a slow frame
        return;
      }
      this.frame(t / 1000);
    };
    requestAnimationFrame(loop);
  }

  syncPause() {
    this.worker?.postMessage({ type: 'pause', paused: !this.visible || document.hidden || !!this.paused });
  }

  setPaused(p) {
    this.paused = p;
    this.syncPause();
  }

  sendParams() {
    this.worker?.postMessage({ type: 'params', params: this.params });
  }

  setParam(k, v) {
    this.params[k] = v;
    this.sendParams();
  }

  setTool(t) {
    this.tool = t;
    this.knife.phase = 'idle';
    this.canvas.dataset.tool = t;
    this.onEvent({ type: 'hint', text: TOOL_HINTS[t] });
  }

  setFlavor(key) {
    this.flavorKey = key;
    this.applyMaterials();
  }

  setDessert(id, toppings) {
    this.toppings = toppings;
    this.counts = { cuts: 0, scoops: 0 };
    this.crumbs.clear();
    this.worker?.postMessage({ type: 'dessert', id, toppings, flavor: this.flavorKey });
  }

  applyMaterials() {
    if (!this.renderer || !this.dessert) return;
    const mats = this.dessert.materials.slice();
    if (this.dessert.id === 'gelatina') mats[0] = jellyMaterial(this.flavorKey);
    this.materials = mats;
    this.renderer.setMaterials(mats);
    this.renderer.flavor = { tint: mats[0].tint, shadowStrength: mats[0].translucency * 0.75 };
  }

  setTheme(theme) {
    this.theme = theme;
    if (this.renderer) this.renderer.setTheme(theme);
  }

  setShowMesh(v) {
    if (this.renderer) this.renderer.showMesh = v;
  }

  shake() {
    this.worker.postMessage({ type: 'shake', dir: [1, 0.3], amp: 0.95 });
  }

  reset() {
    this.counts = { cuts: 0, scoops: 0 };
    this.crumbs.clear();
    this.worker.postMessage({ type: 'reset' });
  }

  // ---- worker ----

  onWorker(m) {
    if (m.type === 'mesh') {
      this.mesh = m;
      this.renderer.setJellyMesh(m);
      if (m.dessert) {
        this.dessert = m.dessert;
        this.matGrid = m.matGrid;
        this.renderer.setMaterialGrid(m.matGrid);
        this.applyMaterials();
        this.crumbs.clear();
        this.onEvent({ type: 'dessert', dessert: m.dessert });
      }
      this.skinned = new Float32Array(m.rest.length);
      this.skinVersion = -1;
      if (m.reason === 'cut') {
        this.counts.cuts++;
        buzz(14);
        this.onEvent({ type: 'cut', pieces: m.pieces });
      }
      if (m.reason === 'scoop' && m.blob) this.startScoopLift(m.blob);
      if (m.reason === 'scoop' && !m.blob) {
        const s = this.spoon;
        s.phase = 'lift';
        s.t0 = performance.now() / 1000;
        s.liftFrom = (s.pos || [0, 8, 0]).slice();
        s.liftPitch = s.pitch ?? 0;
      }
    } else if (m.type === 'frame') {
      if (!this.mesh || m.version !== this.mesh.version) return; // frame from before a rebuild
      this.x = m.x;
      this.frameId = (this.frameId || 0) + 1;
      this.renderer.setFrame(m.x, m.rot);
      this.renderer.setPlateOffset(m.plate);
      this.plateOffset = m.plate;
      this.stats = m.stats;
    } else if (m.type === 'noop' && m.reason === 'scoop') {
      const s = this.spoon;
      s.phase = 'lift';
      s.t0 = performance.now() / 1000;
      s.liftFrom = (s.pos || [0, 8, 0]).slice();
      s.liftPitch = s.pitch ?? 0;
    }
  }

  // ---- picking ----

  skinAll() {
    if (this.skinVersion === this.frameId) return this.skinned;
    const { vNodes, vW } = this.mesh;
    const x = this.x, out = this.skinned;
    const nv = out.length / 3;
    for (let v = 0; v < nv; v++) {
      let px = 0, py = 0, pz = 0;
      for (let c = 0; c < 8; c++) {
        const w = vW[v * 8 + c];
        if (w === 0) continue;
        const n = vNodes[v * 8 + c] * 3;
        px += w * x[n]; py += w * x[n + 1]; pz += w * x[n + 2];
      }
      out[v * 3] = px; out[v * 3 + 1] = py; out[v * 3 + 2] = pz;
    }
    this.skinVersion = this.frameId;
    return out;
  }

  pick(ray) {
    if (!this.mesh || !this.x) return null;
    const P = this.skinAll();
    const T = this.mesh.tris;
    const [ox, oy, oz] = ray.origin, [dx, dy, dz] = ray.dir;
    let best = Infinity, bt = -1, bu = 0, bv = 0;
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
      const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-9) continue;
      const inv = 1 / det;
      const sx = ox - P[a], sy = oy - P[a + 1], sz = oz - P[a + 2];
      const u = (sx * px + sy * py + sz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (d > 0 && d < best) { best = d; bt = t; bu = u; bv = v; }
    }
    if (bt < 0) return null;
    const R = this.mesh.rest, N = this.mesh.restNormals;
    const ia = T[bt], ib = T[bt + 1], ic = T[bt + 2];
    const w0 = 1 - bu - bv;
    const lerp3 = (A, k) => [
      A[ia * 3 + k] * w0 + A[ib * 3 + k] * bu + A[ic * 3 + k] * bv,
    ][0];
    const restPoint = [0, 1, 2].map((k) => lerp3(R, k));
    const restNormal = normalize([0, 1, 2].map((k) => lerp3(N, k)));
    const point = [ox + dx * best, oy + dy * best, oz + dz * best];
    // world normal from the deformed triangle
    const a = ia * 3, b = ib * 3, c = ic * 3;
    let wn = normalize(cross([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]));
    if (dot(wn, ray.dir) > 0) wn = scale(wn, -1);
    return { point, normal: wn, restPoint, restNormal, piece: this.mesh.vPiece[ia], dist: best };
  }

  rayFromEvent(e) {
    return this.rayFromClient(e.clientX, e.clientY);
  }

  rayFromClient(x, y) {
    const r = this.canvas.getBoundingClientRect();
    this.renderer.updateMatrices();
    return this.renderer.ray(x - r.left, y - r.top, r.width, r.height);
  }

  static rayPlane(ray, p0, n) {
    const den = dot(ray.dir, n);
    if (Math.abs(den) < 1e-6) return null;
    const t = dot(sub(p0, ray.origin), n) / den;
    if (t < 0) return null;
    return add(ray.origin, scale(ray.dir, t));
  }

  // ---- pointer ----

  bindPointer() {
    const c = this.canvas;
    let drag = null;
    // On touch screens, only block page scrolling when the finger lands on something to play with.
    c.addEventListener('touchstart', (e) => {
      if (!this.mesh || e.touches.length !== 1) return;
      const t = e.touches[0];
      const hit = this.pick(this.rayFromEvent(t));
      this.touchPick = { x: t.clientX, y: t.clientY, frame: this.frameId, hit };
      if (hit || this.tool === 'knife') e.preventDefault();
    }, { passive: false });

    c.addEventListener('pointerdown', (e) => {
      if (!this.mesh || e.button > 0) return;
      const ray = this.rayFromEvent(e);
      // the touchstart just before already picked this exact spot: reuse it (picking is the costly part on phones)
      const tp = this.touchPick;
      const hit = tp && tp.frame === this.frameId && Math.abs(tp.x - e.clientX) < 2 && Math.abs(tp.y - e.clientY) < 2 ? tp.hit : this.pick(ray);
      this.touchPick = null;
      if (this.tool === 'hand') {
        if (hit) {
          const camN = normalize(sub(this.renderer.eye, hit.point));
          drag = { kind: 'grab', p0: hit.point, n: camN };
          this.worker.postMessage({ type: 'grab', piece: hit.piece, restPoint: hit.restPoint, worldPoint: hit.point });
          c.setPointerCapture(e.pointerId);
          c.dataset.state = 'grabbing';
          this.onEvent({ type: 'interact' });
        } else if (e.pointerType === 'mouse') {
          drag = { kind: 'orbit', x: e.clientX, y: e.clientY, yaw: this.renderer.camera.yaw, pitch: this.renderer.camera.pitch };
          c.setPointerCapture(e.pointerId);
        }
      } else if (this.tool === 'knife') {
        if (this.knife.phase === 'fall') return; // only while the blade is actually going down
        // draw on the height of the dessert's surface under the finger, so the line sits where it's seen
        const h = hit ? hit.point[1] : this.knife.h ?? 3.5;
        const p = JellyApp.rayPlane(ray, [0, h, 0], [0, 1, 0]);
        if (!p) return;
        this.knife = { ...this.knife, phase: 'drawing', a: p, b: p, h, sa: [e.clientX, e.clientY], sb: [e.clientX, e.clientY] };
        drag = { kind: 'knife' };
        c.setPointerCapture(e.pointerId);
        this.onEvent({ type: 'interact' });
      } else if (this.tool === 'spoon') {
        if (hit && (this.spoon.phase === 'idle' || this.spoon.phase === 'hover')) {
          const tip = this.spoonFrame(hit.point);
          const from = this.spoon.pos || add(add(hit.point, [0, 2.2, 0]), scale(tip, -0.6));
          this.spoon = { ...this.spoon, phase: 'dip', target: hit, tip, t0: performance.now() / 1000, from, fromPitch: this.spoon.pitch ?? 0.3 };
          this.onEvent({ type: 'interact' });
        }
      } else if (this.tool === 'tap') {
        if (hit) {
          this.worker.postMessage({ type: 'poke', point: hit.point, dir: ray.dir, strength: 170 });
        } else {
          const d = normalize([ray.dir[0], 0, ray.dir[2]]);
          this.worker.postMessage({ type: 'shake', dir: [d[0] || 1, d[2]], amp: 1.0 });
        }
        this.onEvent({ type: 'interact' });
      }
    });

    c.addEventListener('pointermove', (e) => {
      if (!this.mesh) return;
      this.lastPointer = e;
      if (!drag) return;
      const ray = this.rayFromEvent(e);
      if (drag.kind === 'grab') {
        const p = JellyApp.rayPlane(ray, drag.p0, drag.n);
        if (p) {
          p[1] = Math.max(p[1], -1.0);
          this.worker.postMessage({ type: 'grabMove', worldPoint: p });
        }
      } else if (drag.kind === 'orbit') {
        const cam = this.renderer.camera;
        cam.yaw = clamp(drag.yaw - (e.clientX - drag.x) * 0.006, -1.1, 1.6);
        cam.pitch = clamp(drag.pitch + (e.clientY - drag.y) * 0.004, 0.18, 1.05);
      } else if (drag.kind === 'knife') {
        const p = JellyApp.rayPlane(ray, [0, this.knife.h, 0], [0, 1, 0]);
        if (p) this.knife.b = p;
        this.knife.sb = [e.clientX, e.clientY];
      }
    });

    const end = (e) => {
      if (!drag) return;
      if (drag.kind === 'grab') this.worker.postMessage({ type: 'grabEnd' });
      if (drag.kind === 'knife') this.releaseKnife();
      drag = null;
      c.dataset.state = '';
      try { c.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { if (!drag) this.lastPointer = null; });
  }

  // ---- knife ----

  releaseKnife() {
    const k = this.knife;
    // Find the dessert under the stroke and put the cut line at that height: what you see under
    // your finger is what gets cut, even when the stroke started off the dessert.
    if (k.sa && k.sb) {
      const ys = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const hit = this.pick(this.rayFromClient(lerp(k.sa[0], k.sb[0], t), lerp(k.sa[1], k.sb[1], t)));
        if (hit) ys.push(hit.point[1]);
      }
      if (ys.length) {
        k.h = ys.reduce((a, b) => a + b, 0) / ys.length;
        const a = JellyApp.rayPlane(this.rayFromClient(k.sa[0], k.sa[1]), [0, k.h, 0], [0, 1, 0]);
        const b = JellyApp.rayPlane(this.rayFromClient(k.sb[0], k.sb[1]), [0, k.h, 0], [0, 1, 0]);
        if (a && b) { k.a = a; k.b = b; }
      }
    }
    const ab = sub(k.b, k.a);
    ab[1] = 0;
    const len = Math.hypot(ab[0], ab[2]);
    if (len < 0.8) {
      k.phase = 'hover';
      return;
    }
    k.dir = normalize(ab);
    k.len = len;
    k.phase = 'fall';
    k.t0 = performance.now() / 1000;
    k.cutSent = false;
  }

  piecesCrossing(a, dir, len, normal) {
    const P = this.skinAll();
    const piece = this.mesh.vPiece;
    const info = new Map();
    for (let v = 0; v < piece.length; v++) {
      const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
      const rel = sub(p, a);
      const along = dot(rel, dir);
      if (along < -1.2 || along > len + 1.2) continue;
      const s = dot(rel, normal);
      let e = info.get(piece[v]);
      if (!e) info.set(piece[v], (e = { pos: false, neg: false }));
      if (s > 0.15) e.pos = true;
      if (s < -0.15) e.neg = true;
    }
    return [...info.entries()].filter(([, e]) => e.pos && e.neg).map(([id]) => id);
  }

  knifeModel(now) {
    const k = this.knife;
    const up = [0, 1, 0];
    if (k.phase === 'drawing') {
      const ab = sub(k.b, k.a);
      ab[1] = 0;
      if (Math.hypot(ab[0], ab[2]) > 0.3) k.dir = normalize(ab);
      const mid = scale(add(k.a, k.b), 0.5);
      const z = normalize(cross(k.dir, up));
      return fromBasis(k.dir, up, z, [mid[0], 9.2, mid[2]]);
    }
    if (k.phase === 'fall' || k.phase === 'lift') {
      const mid = add(k.a, scale(k.dir, k.len / 2));
      const z = normalize(cross(k.dir, up));
      const t = now - k.t0;
      let y;
      if (k.phase === 'fall') {
        const T = this.reducedMotion ? 0.12 : 0.32;
        const f = Math.min(1, t / T);
        y = lerp(9.2, -0.2, easeIn(f));
        if (!k.cutSent && f >= 0.55) {
          k.cutSent = true;
          const pieces = this.piecesCrossing(k.a, k.dir, k.len, z);
          if (pieces.length) {
            this.worker.postMessage({ type: 'cut', pieces, point: [k.a[0], 3, k.a[2]], normal: z });
            this.spawnCrumbs((p) => Math.abs(dot(sub(p, k.a), z)) < 0.7 && dot(sub(p, k.a), k.dir) > -0.5 && dot(sub(p, k.a), k.dir) < k.len + 0.5, 40, (p) => {
              const side = dot(sub(p, k.a), z) >= 0 ? 1 : -1;
              return [z[0] * side * 18, 8 + Math.random() * 10, z[2] * side * 18];
            });
          }
        }
        if (f >= 1 && t > T + 0.06) { k.phase = 'lift'; k.t0 = now; }
      } else {
        const f = Math.min(1, t / 0.28);
        y = lerp(-0.2, 9.2, easeOut(f));
        if (f >= 1) k.phase = 'hover';
      }
      return fromBasis(k.dir, up, z, [mid[0], y, mid[2]]);
    }
    if ((k.phase === 'hover' || k.phase === 'idle') && this.lastPointer) {
      const p = JellyApp.rayPlane(this.rayFromEvent(this.lastPointer), [0, k.h ?? 3.5, 0], [0, 1, 0]);
      if (!p) return null;
      k.phase = 'hover';
      const z = normalize(cross(k.dir, up));
      return fromBasis(k.dir, up, z, [p[0], 9.2, p[2]]);
    }
    return null;
  }

  // ---- spoon ----
  //
  // A scoop is a short choreography: hover over the spot, tilt the tip down and push in, slide
  // under while curling the bowl up, then lift away carrying the bite. The handle always points
  // back toward the viewer and up, and the whole spoon is kept above the plate.

  spoonFrame(point) {
    // Seen in profile: the tip points to the viewer's left and a little away, the handle comes
    // back toward the right and the camera, like someone eating from the right side.
    const eye = this.renderer.eye;
    let fwd = [point[0] - eye[0], 0, point[2] - eye[2]];
    fwd = Math.hypot(fwd[0], fwd[2]) > 1e-3 ? normalize(fwd) : [0, 0, -1];
    const right = normalize(cross(fwd, [0, 1, 0]));
    const a = (28 * Math.PI) / 180;
    return normalize([-right[0] * Math.cos(a) + fwd[0] * Math.sin(a), 0, -right[2] * Math.cos(a) + fwd[2] * Math.sin(a)]);
  }

  spoonPose(pos, tip, pitch) {
    // local +x = tip, +y = bowl opening, handle along −x; pitch > 0 tilts the tip down
    const up = [0, 1, 0];
    const c = Math.cos(pitch), s = Math.sin(pitch);
    const x = normalize([tip[0] * c, -s, tip[2] * c]);
    let y = normalize([tip[0] * s, c, tip[2] * s]);
    let z = normalize(cross(x, y));
    // roll the bowl toward the camera so its hollow reads as a spoon
    const eye = this.renderer.eye;
    const toCam = normalize([eye[0] - pos[0], 0, eye[2] - pos[2]]);
    const r = (dot(z, toCam) >= 0 ? 1 : -1) * 0.42;
    const cr = Math.cos(r), sr = Math.sin(r);
    y = normalize([y[0] * cr + z[0] * sr, y[1] * cr + z[1] * sr, y[2] * cr + z[2] * sr]);
    z = normalize(cross(x, y));
    void up;
    let m = fromBasis(x, y, z, pos);
    // keep every part of the spoon above the plate / table
    let lift = 0;
    for (const p of SPOON_PROBES) {
      const wx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
      const wy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
      const wz = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
      const g = groundAt(wx, wz, this.plateOffset || [0, 0]).h + 0.12;
      lift = Math.max(lift, g - wy);
    }
    if (lift > 0) m = translate(m, [0, lift, 0]);
    return m;
  }

  startScoopLift(blob) {
    const s = this.spoon;
    this.renderer.setBlob(blob);
    this.renderer.setBlobModel(blob.model);
    // the bite rides in the bowl: keep its pose relative to the spoon at the moment it was taken
    s.blob = { model: blob.model, rel: mul(invert(s.model), blob.model), fit: fitInBowl(blob.verts, mul(invert(s.model), blob.model)) };
    s.phase = 'lift';
    s.t0 = performance.now() / 1000;
    s.liftFrom = s.pos.slice();
    s.liftPitch = s.pitch;
    this.counts.scoops++;
    buzz(10);
    this.onEvent({ type: 'scoop' });
  }

  spoonModel(now) {
    const s = this.spoon;
    const slow = this.reducedMotion ? 0.35 : 1;
    const set = (pos, pitch) => {
      s.pos = pos;
      s.pitch = pitch;
      s.model = this.spoonPose(pos, s.tip, pitch);
      return s.model;
    };

    if (s.phase === 'dip' || s.phase === 'scoop' || s.phase === 'wait') {
      const t = s.target;
      const n = t.normal;
      const entry = add(t.point, scale(n, 0.15));
      const under = add(add(t.point, scale(n, -0.75)), scale(s.tip, 0.9));
      if (s.phase === 'dip') {
        const f = Math.min(1, (now - s.t0) / (0.24 * slow));
        const e = easeInOut(f);
        set(lerp3(s.from, entry, e), lerp(s.fromPitch, 0.75, e));
        if (f >= 1) {
          s.phase = 'scoop';
          s.t0 = now;
          const restCenter = add(t.restPoint, scale(t.restNormal, -0.5));
          this.worker.postMessage({ type: 'scoop', piece: t.piece, restCenter, radii: [1.3, 0.9, 1.15] });
          this.spawnCrumbs((p) => Math.hypot(p[0] - t.point[0], p[1] - t.point[1], p[2] - t.point[2]) < 1.7, 22, () => [(Math.random() - 0.5) * 22, 10 + Math.random() * 12, (Math.random() - 0.5) * 22]);
        }
        return s.model;
      }
      if (s.phase === 'scoop') {
        const f = Math.min(1, (now - s.t0) / (0.3 * slow));
        const e = easeInOut(f);
        // slide in under the surface while the bowl curls up
        const arc = Math.sin(e * Math.PI) * 0.35;
        const p = add(lerp3(entry, under, e), scale(n, -arc));
        set(p, lerp(0.75, -0.25, e));
        if (f >= 1) { s.phase = 'wait'; s.t0 = now; }
        return s.model;
      }
      // waiting for the cut-out bite from the physics thread
      if (now - s.t0 > 1.5) { s.phase = 'lift'; s.t0 = now; s.liftFrom = s.pos.slice(); s.liftPitch = s.pitch; }
      return s.model;
    }

    if (s.phase === 'lift') {
      const t = now - s.t0;
      const T = 0.95 * slow;
      const f = Math.min(1, t / T);
      // up first, then away toward the viewer's right
      const up = easeOut(Math.min(1, f * 1.4)) * 7.5;
      const away = easeIn(f) * 6;
      const side = normalize(cross([0, 1, 0], s.tip));
      const pos = add(s.liftFrom, add([0, up, 0], add(scale(side, -away), scale(s.tip, -away * 0.6))));
      const fade = f > 0.7 ? 1 - easeIn((f - 0.7) / 0.3) : 1;
      let m = set(pos, lerp(s.liftPitch, -0.45, easeOut(f)));
      if (fade < 1) m = scaleAbout(m, Math.max(0.001, fade));
      if (s.blob) {
        // settle the bite into the bowl during the first moments of the lift
        const k = easeInOut(Math.min(1, t / (0.28 * slow)));
        const local = new Float32Array(16);
        for (let i = 0; i < 16; i++) local[i] = lerp(s.blob.rel[i], s.blob.fit[i], k);
        this.renderer.setBlobModel(mul(m, local));
      }
      if (f >= 1) {
        s.phase = 'idle';
        s.blob = null;
        this.renderer.setBlob(null);
        return null;
      }
      return m;
    }

    if (this.lastPointer && this.lastPointer.pointerType === 'mouse') {
      this.hoverTick = (this.hoverTick || 0) + 1;
      const hit = this.hoverTick % 2 && s.model ? s.hoverHit : this.pick(this.rayFromEvent(this.lastPointer));
      s.hoverHit = hit;
      if (hit) {
        s.phase = 'hover';
        s.tip = this.spoonFrame(hit.point);
        return set(add(add(hit.point, [0, 2.2, 0]), scale(s.tip, -0.6)), 0.3);
      }
    }
    s.phase = 'idle';
    s.pos = null;
    return null;
  }

  // Drop the render resolution step by step while frames keep taking longer than ~28 ms.
  adaptQuality(dt) {
    if (!dt) return;
    this.frameAvg = this.frameAvg ? this.frameAvg * 0.95 + dt * 0.05 : dt;
    const now = performance.now();
    if (now - (this.qualityAt || 0) < 2000) return;
    const q = this.quality || 1;
    if (this.frameAvg > 0.028 && q > 0.55) {
      this.quality = Math.max(0.55, q * 0.8);
      this.qualityAt = now;
      this.resize();
    }
  }

  // ---- crumbs ----

  // Crunchy ingredients near the cut shed a few crumbs, coloured like what they came from.
  spawnCrumbs(near, max, kick) {
    if (!this.matGrid || !this.materials) return;
    const P = this.skinAll();
    const R = this.mesh.rest;
    const cand = [];
    for (let v = 0; v < P.length / 3; v += 3) {
      const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
      if (!near(p)) continue;
      const mat = this.materials[materialAt(this.matGrid, R[v * 3], R[v * 3 + 1], R[v * 3 + 2])];
      if (mat?.crumbly) cand.push({ p, mat });
    }
    for (let i = 0; i < Math.min(max, cand.length); i++) {
      const c = cand[Math.floor(Math.random() * cand.length)];
      const shade = 0.75 + Math.random() * 0.35;
      const col = srgbToLinear(c.mat.albedo).map((x) => x * shade);
      this.crumbs.spawn(c.p, kick(c.p), 0.12 + Math.random() * 0.22, col);
    }
  }

  // ---- frame ----

  resize() {
    const r = this.stage.getBoundingClientRect();
    // phones have dense screens and small GPUs: cap the pixel ratio, and lower it further if frames run long
    const coarse = matchMedia('(pointer: coarse)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.75 : 2) * (this.quality || 1);
    this.renderer.resize(r.width * dpr, r.height * dpr);
    const cam = this.renderer.camera;
    const wide = r.width >= 900;
    const aspect = r.width / Math.max(1, r.height);
    cam.shiftX = wide ? 0.42 : 0;
    cam.shiftY = wide ? 0.1 : 0.06;
    cam.dist = wide ? 46 : aspect < 0.8 ? 56 : 46;
    cam.target = [0, 2.6, 0];
  }

  frame(time) {
    const now = performance.now() / 1000;
    const r = this.renderer;
    r.setKnife(this.tool === 'knife' ? this.knifeModel(now) : null);
    r.setSpoon(this.tool === 'spoon' || this.spoon.phase === 'lift' ? this.spoonModel(now) : null);
    const dt = Math.min(0.05, now - (this.lastFrame || now));
    this.lastFrame = now;
    this.adaptQuality(dt);
    if (this.crumbs.list.length) {
      this.crumbs.step(dt * this.params.timeScale, this.plateOffset || [0, 0]);
      r.setCrumbs(this.crumbs.data, this.crumbs.pack());
    } else r.setCrumbs(this.crumbs.data, 0);
    r.render(time);
    if (this.stats && (!this.lastStats || now - this.lastStats > 0.2)) {
      this.lastStats = now;
      this.onStats({ ...this.stats, cuts: this.counts.cuts, scoops: this.counts.scoops });
    }
  }
}

// Pose (in the spoon's frame) that seats a scooped bite inside the bowl, shrunk to fit if needed.
const BOWL = { len: 3.3, wid: 2.3, depth: 1.5, floor: 0.1 };
function fitInBowl(verts, rel) {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < verts.length; i += 3) {
    const x = verts[i], y = verts[i + 1], z = verts[i + 2];
    const p = [rel[0] * x + rel[4] * y + rel[8] * z, rel[1] * x + rel[5] * y + rel[9] * z, rel[2] * x + rel[6] * y + rel[10] * z];
    for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], p[d]); hi[d] = Math.max(hi[d], p[d]); }
  }
  const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const k = Math.min(1, BOWL.len / ext[0], BOWL.depth / ext[1], BOWL.wid / ext[2]);
  const c = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
  const m = new Float32Array(16);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[j * 4 + i] = rel[j * 4 + i] * k;
  m[15] = 1;
  m[12] = -c[0] * k;
  m[13] = BOWL.floor - c[1] * k;
  m[14] = -c[2] * k;
  return m;
}

function buzz(ms) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not available here */
  }
}

function lerp3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function scaleAbout(m, s) {
  const o = new Float32Array(m);
  for (let i = 0; i < 12; i++) if (i % 4 !== 3) o[i] *= s;
  return o;
}

export { translate };
