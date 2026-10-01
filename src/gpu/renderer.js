// WebGPU renderer: shadow map → opaque scene (plate, table, tools) → jelly back faces (thickness)
// → composite + refractive jelly on top.

import { sceneShader, jellyShader, blobShader, shadowObjShader, compositeShader, meshLinesShader } from './shaders.js';
import { plateMesh, tableMesh, knifeMeshes, spoonMesh, crumbMesh } from './meshes.js';
import { MDIM } from '../sdf.js';
import { perspective, ortho, lookAt, mul, invert, normalize } from '../math.js';

// Touch devices are usually phones: a lighter shadow map is plenty there.
const SHADOW_SIZE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 1024 : 2048;
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

export const srgbToLinear = (c) => c.map((v) => Math.pow(v, 2.2));

export async function createRenderer(canvas) {
  if (!navigator.gpu) throw new Error('no-webgpu');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no-adapter');
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('no-context');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  // Any pipeline or resource the device rejects shows up here, so a GPU that can't run the
  // scene falls back to the illustration instead of leaving a blank stage.
  device.pushErrorScope('validation');
  device.pushErrorScope('out-of-memory');
  const r = new Renderer(device, context, format, canvas);
  const oom = await device.popErrorScope();
  const invalid = await device.popErrorScope();
  if (oom || invalid) throw new Error(`gpu-setup: ${(oom || invalid).message}`);
  return r;
}

class Renderer {
  constructor(device, context, format, canvas) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.canvas = canvas;
    this.lost = false;
    this.onLost = null;
    device.lost.then((info) => {
      this.lost = true;
      if (info.reason !== 'destroyed') this.onLost?.(info);
    });
    device.addEventListener?.('uncapturederror', (e) => {
      this.errors = (this.errors || 0) + 1;
      if (this.errors === 1) console.warn('GPU error:', e.error?.message);
    });

    this.camera = { yaw: 0.32, pitch: 0.4, dist: 36, target: [0, 3.0, 0], fov: (30 * Math.PI) / 180, shiftX: 0, shiftY: 0 };
    this.lightDir = normalize([-0.55, 1.25, 0.55]);
    this.theme = { bgTop: [0.9, 0.92, 0.95], bgBottom: [0.8, 0.83, 0.87], table: [0.86, 0.87, 0.9], plate: [0.96, 0.96, 0.95], dark: 0 };
    this.flavor = { tint: [0.85, 0.05, 0.12], milk: 0, density: 0.32, refraction: 1, gloss: 1 };
    this.showMesh = false;
    this.plateOffset = [0, 0];
    this.tools = { knife: null, spoon: null };
    this.jelly = null;
    this.blob = null;

    this.uniformData = new Float32Array(84);
    this.uniformBuf = device.createBuffer({ size: 84 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    this.createLayouts();
    this.createPipelines();
    this.createStatic();
    this.size = [0, 0];
  }

  createLayouts() {
    const d = this.device;
    const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    this.lFrame = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: VF, buffer: { type: 'uniform' } }] });
    this.lObj = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: VF, buffer: { type: 'uniform' } }] });
    this.lShadow = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
      ],
    });
    this.lNodes = d.createBindGroupLayout({
      entries: [0, 1, 2].map((b) => ({ binding: b, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } })),
    });
    this.lJellyTex = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '3d' } },
      ],
    });
    this.lComposite = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }] });
    this.frameGroup = d.createBindGroup({ layout: this.lFrame, entries: [{ binding: 0, resource: { buffer: this.uniformBuf } }] });
  }

  createPipelines() {
    const d = this.device;
    const mod = (code) => d.createShaderModule({ code });
    const scene = mod(sceneShader), jelly = mod(jellyShader), blob = mod(blobShader), shadowObj = mod(shadowObjShader);
    const comp = mod(compositeShader), lines = mod(meshLinesShader);
    const layout = (...g) => d.createPipelineLayout({ bindGroupLayouts: g });
    const objVB = [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] }];
    const jellyVB = [{
      arrayStride: 88,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'uint32x4' },
        { shaderLocation: 2, offset: 28, format: 'uint32x4' },
        { shaderLocation: 3, offset: 44, format: 'float32x4' },
        { shaderLocation: 4, offset: 60, format: 'float32x4' },
        { shaderLocation: 5, offset: 76, format: 'float32x3' },
      ],
    }];
    const crumbVB = [
      objVB[0],
      {
        arrayStride: 48,
        stepMode: 'instance',
        attributes: [
          { shaderLocation: 2, offset: 0, format: 'float32x4' },
          { shaderLocation: 3, offset: 16, format: 'float32x4' },
          { shaderLocation: 4, offset: 32, format: 'float32x4' },
        ],
      },
    ];
    const sceneTargets = [{ format: 'rgba16float' }, { format: 'r32float' }];
    const depth = (write = true, compare = 'less', format = 'depth24plus') => ({ format, depthWriteEnabled: write, depthCompare: compare });

    this.pBg = d.createRenderPipeline({
      layout: layout(this.lFrame),
      vertex: { module: scene, entryPoint: 'vsBg' },
      fragment: { module: scene, entryPoint: 'fsBg', targets: sceneTargets },
      primitive: { topology: 'triangle-list' },
      depthStencil: depth(false, 'always'),
    });
    this.pObj = d.createRenderPipeline({
      layout: layout(this.lFrame, this.lObj, this.lShadow),
      vertex: { module: scene, entryPoint: 'vsObj', buffers: objVB },
      fragment: { module: scene, entryPoint: 'fsObj', targets: sceneTargets },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depth(),
    });
    this.pCrumb = d.createRenderPipeline({
      layout: layout(this.lFrame, this.lObj, this.lShadow),
      vertex: { module: scene, entryPoint: 'vsCrumb', buffers: crumbVB },
      fragment: { module: scene, entryPoint: 'fsCrumb', targets: sceneTargets },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: depth(),
    });
    this.pObjShadow = d.createRenderPipeline({
      layout: layout(this.lFrame, this.lObj),
      vertex: { module: shadowObj, entryPoint: 'vsShadow', buffers: objVB },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depth(true, 'less', 'depth32float'),
    });
    this.pJellyShadow = d.createRenderPipeline({
      layout: layout(this.lFrame, this.lNodes),
      vertex: { module: jelly, entryPoint: 'vsJellyShadow', buffers: jellyVB },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depth(true, 'less', 'depth32float'),
    });
    this.pJellyBack = d.createRenderPipeline({
      layout: layout(this.lFrame, this.lNodes),
      vertex: { module: jelly, entryPoint: 'vsJelly', buffers: jellyVB },
      fragment: { module: jelly, entryPoint: 'fsBack', targets: [{ format: 'r32float' }] },
      primitive: { topology: 'triangle-list', cullMode: 'front' },
      depthStencil: depth(),
    });
    this.pJelly = d.createRenderPipeline({
      layout: layout(this.lFrame, this.lNodes, this.lJellyTex),
      vertex: { module: jelly, entryPoint: 'vsJelly', buffers: jellyVB },
      fragment: { module: jelly, entryPoint: 'fsJelly', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: depth(),
    });
    this.pBlobShadow = d.createRenderPipeline({
      layout: layout(this.lFrame, this.lObj),
      vertex: { module: blob, entryPoint: 'vsBlobShadow', buffers: objVB },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depth(true, 'less', 'depth32float'),
    });
    this.pBlobBack = d.createRenderPipeline({
      layout: layout(this.lFrame, this.lObj),
      vertex: { module: blob, entryPoint: 'vsBlob', buffers: objVB },
      fragment: { module: blob, entryPoint: 'fsBack', targets: [{ format: 'r32float' }] },
      primitive: { topology: 'triangle-list', cullMode: 'front' },
      depthStencil: depth(),
    });
    this.pBlob = d.createRenderPipeline({
      layout: layout(this.lFrame, this.lObj, this.lJellyTex),
      vertex: { module: blob, entryPoint: 'vsBlob', buffers: objVB },
      fragment: { module: blob, entryPoint: 'fsJelly', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: depth(),
    });
    this.pComposite = d.createRenderPipeline({
      layout: layout(this.lFrame, this.lComposite),
      vertex: { module: comp, entryPoint: 'vsFull' },
      fragment: { module: comp, entryPoint: 'fsFull', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: depth(false, 'always'),
    });
    this.pLines = d.createRenderPipeline({
      layout: layout(this.lFrame, this.lNodes),
      vertex: { module: lines, entryPoint: 'vsLines' },
      fragment: {
        module: lines,
        entryPoint: 'fsLines',
        targets: [{ format: this.format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } }],
      },
      primitive: { topology: 'line-list' },
      depthStencil: depth(false, 'always'),
    });
  }

  meshBuffers(mesh) {
    const d = this.device;
    const vb = d.createBuffer({ size: mesh.verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(vb, 0, mesh.verts);
    const ib = d.createBuffer({ size: Math.max(4, mesh.idx.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(ib, 0, mesh.idx);
    return { vb, ib, count: mesh.idx.length };
  }

  makeObject(mesh, color, params) {
    const buf = this.device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const o = { ...this.meshBuffers(mesh), buf, color, params, model: IDENTITY, visible: true };
    o.group = this.device.createBindGroup({ layout: this.lObj, entries: [{ binding: 0, resource: { buffer: buf } }] });
    this.writeObject(o);
    return o;
  }

  writeObject(o) {
    const data = new Float32Array(24);
    data.set(o.model, 0);
    data.set([...o.color, 1], 16);
    data.set(o.params, 20);
    this.device.queue.writeBuffer(o.buf, 0, data);
  }

  createStatic() {
    const d = this.device;
    this.table = this.makeObject(tableMesh(), [0.8, 0.8, 0.8], [0.7, 0, 1, 1]);
    this.plate = this.makeObject(plateMesh(), [0.92, 0.92, 0.9], [0.18, 0, 0, 1]);
    const k = knifeMeshes();
    this.knifeBlade = this.makeObject(k.blade, [0.86, 0.87, 0.9], [0.18, 1, 2, 1]);
    this.knifeHandle = this.makeObject(k.handle, [0.09, 0.05, 0.035], [0.45, 0, 3, 1]);
    this.spoon = this.makeObject(spoonMesh(), [0.88, 0.88, 0.9], [0.14, 1, 2, 1]);
    this.knifeBlade.visible = this.knifeHandle.visible = this.spoon.visible = false;
    this.blobObj = null;

    this.shadowTex = d.createTexture({ size: [SHADOW_SIZE, SHADOW_SIZE], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.shadowGroup = d.createBindGroup({
      layout: this.lShadow,
      entries: [
        { binding: 0, resource: this.shadowTex.createView() },
        { binding: 1, resource: d.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' }) },
      ],
    });
    this.linearSampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.matBuf = d.createBuffer({ size: 8 * 12 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.matTex = d.createTexture({ size: MDIM, dimension: '3d', format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.crumbMesh = this.meshBuffers(crumbMesh());
    this.crumbCap = 400;
    this.crumbBuf = d.createBuffer({ size: this.crumbCap * 48, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.crumbCount = 0;
    // placeholder node buffers until the first mesh arrives
    this.ensureNodeCapacity(8);
    this.lineBuf = d.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.lineCount = 0;
    this.rebuildNodeGroup();
  }

  ensureNodeCapacity(n) {
    if (this.nodeCap >= n) return;
    this.nodeCap = Math.ceil(n * 1.25);
    const d = this.device;
    const mk = () => d.createBuffer({ size: this.nodeCap * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.posBuf = mk();
    this.rotBuf = mk();
    this.posData = new Float32Array(this.nodeCap * 4);
    this.rotData = new Float32Array(this.nodeCap * 4);
    if (this.lineBuf) this.rebuildNodeGroup();
  }

  rebuildNodeGroup() {
    this.nodeGroup = this.device.createBindGroup({
      layout: this.lNodes,
      entries: [
        { binding: 0, resource: { buffer: this.posBuf } },
        { binding: 1, resource: { buffer: this.rotBuf } },
        { binding: 2, resource: { buffer: this.lineBuf } },
      ],
    });
  }

  setJellyMesh(m) {
    const d = this.device;
    const nv = m.rest.length / 3;
    const buf = new ArrayBuffer(nv * 88);
    const f = new Float32Array(buf), u = new Uint32Array(buf);
    for (let v = 0; v < nv; v++) {
      const b = v * 22;
      f[b + 19] = m.rest[v * 3]; f[b + 20] = m.rest[v * 3 + 1]; f[b + 21] = m.rest[v * 3 + 2];
      f[b] = m.restNormals[v * 3]; f[b + 1] = m.restNormals[v * 3 + 1]; f[b + 2] = m.restNormals[v * 3 + 2];
      for (let c = 0; c < 8; c++) {
        u[b + 3 + c] = m.vNodes[v * 8 + c];
        f[b + 11 + c] = m.vW[v * 8 + c];
      }
    }
    if (this.jelly) { this.jelly.vb.destroy(); this.jelly.ib.destroy(); }
    const vb = d.createBuffer({ size: buf.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(vb, 0, buf);
    const ib = d.createBuffer({ size: m.tris.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(ib, 0, m.tris);
    this.jelly = { vb, ib, count: m.tris.length };

    this.ensureNodeCapacity(m.nNodes);
    const seen = new Set();
    const lines = [];
    for (let cp = 0; cp < m.copyNodes.length / 8; cp++)
      for (const [a, b] of EDGES) {
        const na = m.copyNodes[cp * 8 + a], nb = m.copyNodes[cp * 8 + b];
        const key = na < nb ? na * 1e6 + nb : nb * 1e6 + na;
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push(na, nb);
      }
    this.lineBuf.destroy();
    this.lineBuf = d.createBuffer({ size: Math.max(16, lines.length * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(this.lineBuf, 0, new Uint32Array(lines));
    this.lineCount = lines.length;
    this.rebuildNodeGroup();
  }

  // Ingredient table (sRGB colours in, linear out) and the rest-space ingredient map.
  setMaterials(list) {
    const data = new Float32Array(8 * 12);
    list.slice(0, 8).forEach((m, i) => {
      data.set([...srgbToLinear(m.albedo), m.translucency], i * 12);
      data.set([...srgbToLinear(m.tint), m.density], i * 12 + 4);
      data.set([m.rough, m.scatter, m.grain, m.grainScale], i * 12 + 8);
    });
    this.device.queue.writeBuffer(this.matBuf, 0, data);
  }

  setMaterialGrid(grid) {
    this.device.queue.writeTexture({ texture: this.matTex }, grid, { bytesPerRow: MDIM[0], rowsPerImage: MDIM[1] }, MDIM);
  }

  // Crumbs: Float32Array of [x, y, z, size, qx, qy, qz, qw, r, g, b, 1] per crumb (linear colour).
  setCrumbs(data, count) {
    this.crumbCount = Math.min(count, this.crumbCap);
    if (this.crumbCount) this.device.queue.writeBuffer(this.crumbBuf, 0, data, 0, this.crumbCount * 12);
  }

  setFrame(x, rot) {
    const n = x.length / 3;
    this.ensureNodeCapacity(n);
    const p = this.posData, r = this.rotData;
    for (let i = 0; i < n; i++) {
      p[i * 4] = x[i * 3]; p[i * 4 + 1] = x[i * 3 + 1]; p[i * 4 + 2] = x[i * 3 + 2]; p[i * 4 + 3] = 1;
    }
    r.set(rot.subarray(0, n * 4));
    this.device.queue.writeBuffer(this.posBuf, 0, p, 0, n * 4);
    this.device.queue.writeBuffer(this.rotBuf, 0, r, 0, n * 4);
  }

  setBlob(blob) {
    if (this.blobObj) {
      this.blobObj.vb.destroy();
      this.blobObj.ib.destroy();
      this.blobObj = null;
    }
    if (!blob) return;
    const nv = blob.verts.length / 3;
    const verts = new Float32Array(nv * 6);
    for (let v = 0; v < nv; v++) {
      verts.set(blob.verts.subarray(v * 3, v * 3 + 3), v * 6);
      verts.set(blob.normals.subarray(v * 3, v * 3 + 3), v * 6 + 3);
    }
    this.blobObj = this.makeObject({ verts, idx: blob.tris }, [1, 1, 1], [0, 0, 0, 1]);
  }

  setBlobModel(m) {
    if (!this.blobObj) return;
    this.blobObj.model = m;
    this.writeObject(this.blobObj);
  }

  setKnife(model) {
    const vis = !!model;
    this.knifeBlade.visible = this.knifeHandle.visible = vis;
    if (vis) {
      this.knifeBlade.model = this.knifeHandle.model = model;
      this.writeObject(this.knifeBlade);
      this.writeObject(this.knifeHandle);
    }
  }

  setSpoon(model) {
    this.spoon.visible = !!model;
    if (model) {
      this.spoon.model = model;
      this.writeObject(this.spoon);
    }
  }

  setPlateOffset(o) {
    this.plateOffset = o;
    const m = new Float32Array(IDENTITY);
    m[12] = o[0];
    m[14] = o[1];
    this.plate.model = m;
    this.writeObject(this.plate);
  }

  setTheme(t) {
    this.theme = t;
    this.table.color = srgbToLinear(t.table);
    this.plate.color = srgbToLinear(t.plate);
    this.writeObject(this.table);
    this.writeObject(this.plate);
  }

  resize(w, h) {
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    if (w === this.size[0] && h === this.size[1]) return;
    this.size = [w, h];
    this.canvas.width = w;
    this.canvas.height = h;
    const d = this.device;
    for (const t of ['sceneColor', 'sceneLin', 'depth', 'backLin', 'backDepth']) this[t]?.destroy();
    const tex = (format, usage) => d.createTexture({ size: [w, h], format, usage });
    const RA = GPUTextureUsage.RENDER_ATTACHMENT, TB = GPUTextureUsage.TEXTURE_BINDING;
    this.sceneColor = tex('rgba16float', RA | TB);
    this.sceneLin = tex('r32float', RA | TB);
    this.depth = tex('depth24plus', RA);
    this.backLin = tex('r32float', RA | TB);
    this.backDepth = tex('depth24plus', RA);
    this.jellyTexGroup = d.createBindGroup({
      layout: this.lJellyTex,
      entries: [
        { binding: 0, resource: this.sceneColor.createView() },
        { binding: 1, resource: this.linearSampler },
        { binding: 2, resource: this.sceneLin.createView() },
        { binding: 3, resource: this.backLin.createView() },
        { binding: 4, resource: { buffer: this.matBuf } },
        { binding: 5, resource: this.matTex.createView({ dimension: '3d' }) },
      ],
    });
    this.compositeGroup = d.createBindGroup({ layout: this.lComposite, entries: [{ binding: 0, resource: this.sceneColor.createView() }] });
  }

  get eye() {
    const c = this.camera;
    return [
      c.target[0] + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw),
      c.target[1] + c.dist * Math.sin(c.pitch),
      c.target[2] + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw),
    ];
  }

  updateMatrices() {
    const c = this.camera;
    const aspect = this.size[0] / this.size[1];
    this.view = lookAt(this.eye, c.target);
    this.proj = perspective(c.fov, aspect, 1, 300, -c.shiftX, -c.shiftY);
    this.viewProj = mul(this.proj, this.view);
    this.invViewProj = invert(this.viewProj);
    const L = this.lightDir;
    const lv = lookAt([L[0] * 45, L[1] * 45, L[2] * 45], [0, 0, 0], [0, 0, -1]);
    this.lightViewProj = mul(ortho(-17, 17, -17, 17, 1, 95), lv);
  }

  writeUniforms(time) {
    const u = this.uniformData;
    u.set(this.viewProj, 0);
    u.set(this.view, 16);
    u.set(this.lightViewProj, 32);
    u.set([...this.eye, 1], 48);
    u.set([...this.lightDir, 0], 52);
    u.set([this.size[0], this.size[1], 1 / this.size[0], 1 / this.size[1]], 56);
    const f = this.flavor;
    u.set([...srgbToLinear(f.tint), f.milk], 60);
    u.set([f.density, f.refraction, time, f.gloss], 64);
    u.set([...srgbToLinear(this.theme.bgTop), 1], 68);
    u.set([...srgbToLinear(this.theme.bgBottom), 1], 72);
    u.set([...srgbToLinear(this.theme.table), 1], 76);
    u.set([this.plateOffset[0], this.plateOffset[1], f.shadowStrength ?? 0.75, this.theme.dark], 80);
    this.device.queue.writeBuffer(this.uniformBuf, 0, u);
  }

  render(time) {
    if (this.lost || !this.sceneColor || this.size[0] < 2 || this.size[1] < 2) return;
    const d = this.device;
    this.updateMatrices();
    this.writeUniforms(time);
    const enc = d.createCommandEncoder();
    const drawObj = (pass, o) => {
      pass.setBindGroup(1, o.group);
      pass.setVertexBuffer(0, o.vb);
      pass.setIndexBuffer(o.ib, 'uint32');
      pass.drawIndexed(o.count);
    };
    const drawJelly = (pass) => {
      pass.setBindGroup(1, this.nodeGroup);
      pass.setVertexBuffer(0, this.jelly.vb);
      pass.setIndexBuffer(this.jelly.ib, 'uint32');
      pass.drawIndexed(this.jelly.count);
    };
    const tools = [this.knifeBlade, this.knifeHandle, this.spoon].filter((o) => o.visible);

    // 1. shadow map
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: { view: this.shadowTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setBindGroup(0, this.frameGroup);
      if (this.jelly) {
        pass.setPipeline(this.pJellyShadow);
        drawJelly(pass);
      }
      // the plate blocks the light too, so nothing on it throws a shadow onto the table below
      pass.setPipeline(this.pObjShadow);
      drawObj(pass, this.plate);
      for (const o of tools) drawObj(pass, o);
      if (this.blobObj) {
        pass.setPipeline(this.pBlobShadow);
        drawObj(pass, this.blobObj);
      }
      pass.end();
    }

    // 2. opaque scene
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [
          { view: this.sceneColor.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
          { view: this.sceneLin.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [1e5, 0, 0, 1] },
        ],
        depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setBindGroup(0, this.frameGroup);
      pass.setPipeline(this.pBg);
      pass.draw(3);
      pass.setPipeline(this.pObj);
      pass.setBindGroup(2, this.shadowGroup);
      drawObj(pass, this.table);
      drawObj(pass, this.plate);
      for (const o of tools) drawObj(pass, o);
      if (this.crumbCount) {
        pass.setPipeline(this.pCrumb);
        pass.setBindGroup(1, this.table.group);
        pass.setVertexBuffer(0, this.crumbMesh.vb);
        pass.setVertexBuffer(1, this.crumbBuf);
        pass.setIndexBuffer(this.crumbMesh.ib, 'uint32');
        pass.drawIndexed(this.crumbMesh.count, this.crumbCount);
      }
      pass.end();
    }

    // 3. jelly back faces → thickness
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: this.backLin.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [1e5, 0, 0, 1] }],
        depthStencilAttachment: { view: this.backDepth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setBindGroup(0, this.frameGroup);
      if (this.jelly) {
        pass.setPipeline(this.pJellyBack);
        drawJelly(pass);
      }
      if (this.blobObj) {
        pass.setPipeline(this.pBlobBack);
        drawObj(pass, this.blobObj);
      }
      pass.end();
    }

    // 4. composite + jelly
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        depthStencilAttachment: { view: this.depth.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
      });
      pass.setBindGroup(0, this.frameGroup);
      pass.setPipeline(this.pComposite);
      pass.setBindGroup(1, this.compositeGroup);
      pass.draw(3);
      if (this.jelly) {
        pass.setPipeline(this.pJelly);
        pass.setBindGroup(2, this.jellyTexGroup);
        drawJelly(pass);
      }
      if (this.blobObj) {
        pass.setPipeline(this.pBlob);
        pass.setBindGroup(2, this.jellyTexGroup);
        drawObj(pass, this.blobObj);
      }
      if (this.showMesh && this.lineCount) {
        pass.setPipeline(this.pLines);
        pass.setBindGroup(1, this.nodeGroup);
        pass.draw(this.lineCount);
      }
      pass.end();
    }
    d.queue.submit([enc.finish()]);
  }

  // Ray through a pixel (CSS px relative to the canvas).
  ray(px, py, cssW, cssH) {
    const x = (px / cssW) * 2 - 1, y = 1 - (py / cssH) * 2;
    const m = this.invViewProj;
    const un = (z) => {
      const vx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const vy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const vz = m[2] * x + m[6] * y + m[10] * z + m[14];
      const vw = m[3] * x + m[7] * y + m[11] * z + m[15];
      return [vx / vw, vy / vw, vz / vw];
    };
    const a = un(0), b = un(1);
    return { origin: a, dir: normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]) };
  }
}
