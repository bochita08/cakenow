// WGSL for every pass. Colours are linear inside the pipeline and encoded to sRGB on the way out.

const common = /* wgsl */ `
struct U {
  viewProj: mat4x4f,
  view: mat4x4f,
  lightViewProj: mat4x4f,
  camPos: vec4f,
  lightDir: vec4f,
  res: vec4f,
  tint: vec4f,      // transmitted colour of the jelly (linear), w = milkiness
  jelly: vec4f,     // x density, y refraction, z time, w gloss
  bgTop: vec4f,
  bgBottom: vec4f,
  table: vec4f,
  misc: vec4f,      // x plate offset x, y plate offset z, z shadow strength, w dark theme
};
@group(0) @binding(0) var<uniform> u: U;

fn qrot(q: vec4f, v: vec3f) -> vec3f {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

fn toSrgb(c: vec3f) -> vec3f {
  return pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
}

// Studio lighting: soft sky, warm floor bounce and two softboxes.
fn envLight(d: vec3f) -> vec3f {
  let sky = mix(u.bgBottom.rgb * 0.9, u.bgTop.rgb * 1.1, smoothstep(-0.25, 0.6, d.y));
  var c = sky;
  // big key softbox overhead, tilted toward the camera-left
  let kd = normalize(vec3f(-0.45, 1.0, 0.45));
  let k = smoothstep(0.86, 0.95, dot(d, kd));
  c += vec3f(2.6, 2.5, 2.4) * k;
  // narrow strip light behind-right for a rim
  let sd = normalize(vec3f(0.8, 0.35, -0.6));
  let s = smoothstep(0.93, 0.975, dot(d, sd));
  c += vec3f(1.6, 1.55, 1.5) * s;
  return c;
}

fn ggx(N: vec3f, V: vec3f, L: vec3f, rough: f32) -> f32 {
  let H = normalize(V + L);
  let a = rough * rough;
  let a2 = a * a;
  let nh = max(dot(N, H), 0.0);
  let d = nh * nh * (a2 - 1.0) + 1.0;
  let D = a2 / (3.14159 * d * d);
  let nl = max(dot(N, L), 0.0);
  let nv = max(dot(N, V), 0.001);
  let k = (rough + 1.0) * (rough + 1.0) / 8.0;
  let G = (nl / (nl * (1.0 - k) + k)) * (nv / (nv * (1.0 - k) + k));
  return D * G / (4.0 * nv + 0.001);
}
`;

export const sceneShader = /* wgsl */ `
${common}

struct Obj {
  model: mat4x4f,
  color: vec4f,    // linear albedo, w unused
  params: vec4f,   // x roughness, y metal, z kind (0 ceramic, 1 table, 2 metal, 3 wood), w opacity
};
@group(1) @binding(0) var<uniform> obj: Obj;
@group(2) @binding(0) var shadowMap: texture_depth_2d;
@group(2) @binding(1) var shadowSampler: sampler_comparison;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
};

@vertex fn vsObj(@location(0) p: vec3f, @location(1) n: vec3f) -> VOut {
  var o: VOut;
  let w = obj.model * vec4f(p, 1.0);
  o.wp = w.xyz;
  o.n = normalize((obj.model * vec4f(n, 0.0)).xyz);
  o.pos = u.viewProj * w;
  return o;
}

fn shadowAt(wp: vec3f, n: vec3f) -> f32 {
  let lp = u.lightViewProj * vec4f(wp + n * 0.12, 1.0);
  let uv = vec2f(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 1.0; }
  let texel = 1.0 / 2048.0;
  var s = 0.0;
  for (var y = -2; y <= 2; y++) {
    for (var x = -2; x <= 2; x++) {
      s += textureSampleCompareLevel(shadowMap, shadowSampler, uv + vec2f(f32(x), f32(y)) * texel * 2.2, lp.z - 0.0015);
    }
  }
  return s / 25.0;
}

struct FOut {
  @location(0) color: vec4f,
  @location(1) lin: vec4f,
};

@fragment fn fsObj(i: VOut, @builtin(front_facing) ff: bool) -> FOut {
  var N = normalize(i.n);
  if (!ff) { N = -N; }
  let V = normalize(u.camPos.xyz - i.wp);
  let L = normalize(u.lightDir.xyz);
  let kind = obj.params.z;
  let rough = obj.params.x;
  let metal = obj.params.y;
  var albedo = obj.color.rgb;
  var sh = 1.0;
  if (kind < 1.5) {
    sh = shadowAt(i.wp, N);
  }
  // translucent jelly casts a coloured shadow
  let shadowTint = mix(vec3f(0.5, 0.48, 0.52), u.tint.rgb * 0.75 + 0.12, u.misc.z);
  let shade = mix(shadowTint, vec3f(1.0), sh);
  let nl = max(dot(N, L), 0.0);
  let amb = mix(u.bgBottom.rgb, u.bgTop.rgb, N.y * 0.5 + 0.5) * 0.55;
  var c = albedo * (amb + vec3f(1.05, 1.0, 0.95) * nl * 0.85) * shade;
  let R = reflect(-V, N);
  let F0 = mix(vec3f(0.04), albedo, metal);
  let F = F0 + (1.0 - F0) * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  let env = envLight(R);
  let reflAmt = select(0.35, 1.0, metal > 0.5) * (1.0 - rough * 0.8);
  c = mix(c, env * select(vec3f(1.0), albedo, metal > 0.5), F * reflAmt);
  if (metal > 0.5) {
    c = albedo * (amb * 0.4 + env * 0.65) * shade;
  }
  c += vec3f(1.0) * ggx(N, V, L, max(rough, 0.08)) * nl * 0.9 * sh;
  if (kind > 0.5 && kind < 1.5) {
    // table fades into the backdrop with distance
    let d = length(i.wp.xz);
    let fogT = smoothstep(22.0, 60.0, d);
    c = mix(c, u.bgTop.rgb, fogT);
  }
  var o: FOut;
  o.color = vec4f(c, 1.0);
  o.lin = vec4f(-(u.view * vec4f(i.wp, 1.0)).z, 0.0, 0.0, 1.0);
  return o;
}

// Crumbs: small instanced chunks that fall off crunchy desserts.
struct CrumbOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) color: vec3f,
};
@vertex fn vsCrumb(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) ip: vec4f, @location(3) iq: vec4f, @location(4) ic: vec4f) -> CrumbOut {
  var o: CrumbOut;
  o.wp = qrot(iq, p * ip.w) + ip.xyz;
  o.n = qrot(iq, n);
  o.color = ic.rgb;
  o.pos = u.viewProj * vec4f(o.wp, 1.0);
  return o;
}
@fragment fn fsCrumb(i: CrumbOut) -> FOut {
  let N = normalize(i.n);
  let L = normalize(u.lightDir.xyz);
  let sh = shadowAt(i.wp, N);
  let amb = mix(u.bgBottom.rgb, u.bgTop.rgb, N.y * 0.5 + 0.5) * 0.55;
  let c = i.color * (amb + vec3f(1.05, 1.0, 0.95) * max(dot(N, L), 0.0) * 0.9 * mix(0.45, 1.0, sh));
  var o: FOut;
  o.color = vec4f(c, 1.0);
  o.lin = vec4f(-(u.view * vec4f(i.wp, 1.0)).z, 0.0, 0.0, 1.0);
  return o;
}

// Backdrop behind everything.
struct BOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vsBg(@builtin(vertex_index) vi: u32) -> BOut {
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: BOut;
  o.pos = vec4f(p[vi], 1.0, 1.0);
  o.uv = p[vi] * 0.5 + 0.5;
  return o;
}
@fragment fn fsBg(i: BOut) -> FOut {
  var o: FOut;
  let t = smoothstep(0.0, 1.0, i.uv.y);
  o.color = vec4f(mix(u.bgTop.rgb, u.bgTop.rgb * 1.02, t), 1.0);
  o.lin = vec4f(1e5, 0.0, 0.0, 1.0);
  return o;
}
`;

const jellySkin = /* wgsl */ `
@group(1) @binding(0) var<storage, read> nodePos: array<vec4f>;
@group(1) @binding(1) var<storage, read> nodeRot: array<vec4f>;

struct Skinned { p: vec3f, n: vec3f };

fn skin(rn: vec3f, n0: vec4u, n1: vec4u, w0: vec4f, w1: vec4f) -> Skinned {
  var p = vec3f(0.0);
  var n = vec3f(0.0);
  let ids = array<u32, 8>(n0.x, n0.y, n0.z, n0.w, n1.x, n1.y, n1.z, n1.w);
  let ws = array<f32, 8>(w0.x, w0.y, w0.z, w0.w, w1.x, w1.y, w1.z, w1.w);
  for (var c = 0u; c < 8u; c++) {
    let w = ws[c];
    if (w > 0.0) {
      p += w * nodePos[ids[c]].xyz;
      n += w * qrot(nodeRot[ids[c]], rn);
    }
  }
  var s: Skinned;
  s.p = p;
  s.n = normalize(n);
  return s;
}
`;

const jellyShade = /* wgsl */ `
@group(2) @binding(0) var sceneColor: texture_2d<f32>;
@group(2) @binding(1) var sceneSampler: sampler;
@group(2) @binding(2) var sceneLin: texture_2d<f32>;
@group(2) @binding(3) var backLin: texture_2d<f32>;

// Ingredients: a = albedo + translucency, t = transmitted tint + density,
// r = roughness, scatter, grain amount, grain scale.
struct Mat { a: vec4f, t: vec4f, r: vec4f };
struct Mats { m: array<Mat, 8> };
@group(2) @binding(4) var<uniform> mats: Mats;
@group(2) @binding(5) var matTex: texture_3d<f32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) rp: vec3f,
};

@fragment fn fsBack(i: VOut) -> @location(0) vec4f {
  return vec4f(-(u.view * vec4f(i.wp, 1.0)).z, 0.0, 0.0, 1.0);
}

fn hash3(p: vec3f) -> f32 {
  var q = fract(p * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

fn vnoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  let a = mix(mix(hash3(i), hash3(i + vec3f(1.0, 0.0, 0.0)), w.x), mix(hash3(i + vec3f(0.0, 1.0, 0.0)), hash3(i + vec3f(1.0, 1.0, 0.0)), w.x), w.y);
  let b = mix(mix(hash3(i + vec3f(0.0, 0.0, 1.0)), hash3(i + vec3f(1.0, 0.0, 1.0)), w.x), mix(hash3(i + vec3f(0.0, 1.0, 1.0)), hash3(i + vec3f(1.0, 1.0, 1.0)), w.x), w.y);
  return mix(a, b, w.z);
}

fn materialIndex(rp: vec3f) -> u32 {
  let dims = vec3i(textureDimensions(matTex));
  let c = clamp(vec3i(floor((rp - vec3f(-9.0, 0.0, -9.0)) / 0.125)), vec3i(0), dims - vec3i(1));
  return min(u32(textureLoad(matTex, c, 0).r * 255.0 + 0.5), 7u);
}

fn shadeJelly(wp: vec3f, nIn: vec3f, fragPos: vec4f, rp: vec3f) -> vec4f {
  let M = mats.m[materialIndex(rp)];
  var N = normalize(nIn);
  let V = normalize(u.camPos.xyz - wp);
  let L = normalize(u.lightDir.xyz);
  let rough = M.r.x;
  let scatter = M.r.y;
  let grainAmt = M.r.z;
  let gs = M.r.w;

  // crumbly, porous ingredients get a little surface relief
  if (grainAmt > 0.15) {
    let e = 0.04;
    let sp = rp * gs * 1.9;
    let n0 = vnoise(sp);
    let g = vec3f(vnoise(sp + vec3f(e * gs, 0.0, 0.0)) - n0, vnoise(sp + vec3f(0.0, e * gs, 0.0)) - n0, vnoise(sp + vec3f(0.0, 0.0, e * gs)) - n0);
    N = normalize(N - g * (0.9 * grainAmt));
  }
  let NdV = max(dot(N, V), 0.0);
  let NdL = dot(N, L);
  let R = reflect(-V, N);
  let F = 0.035 + 0.965 * pow(1.0 - NdV, 5.0);
  let amb = mix(u.bgBottom.rgb, u.bgTop.rgb, N.y * 0.5 + 0.5);

  // ---- opaque: cake, cream, meringue, chocolate
  let g1 = vnoise(rp * gs);
  let g2 = vnoise(rp * gs * 2.7 + vec3f(17.0));
  var alb = M.a.rgb * clamp(1.0 + (g1 * 0.65 + g2 * 0.35 - 0.5) * grainAmt * 1.8, 0.35, 1.6);
  let pore = smoothstep(0.74, 0.9, vnoise(rp * gs * 1.9 + vec3f(5.0))) * grainAmt;
  alb *= 1.0 - pore * 0.55;
  let wrapL = max((NdL + scatter * 0.6) / (1.0 + scatter * 0.6), 0.0);
  var opaque = alb * (amb * 0.55 + vec3f(1.05, 1.0, 0.95) * wrapL * 0.95);
  opaque += alb * scatter * 0.2 * pow(1.0 - NdV, 2.0);
  opaque = mix(opaque, envLight(R), F * (1.0 - rough) * (1.0 - rough) * 0.9);
  opaque += vec3f(1.0, 0.98, 0.95) * ggx(N, V, L, max(rough, 0.06)) * max(NdL, 0.0) * (1.0 - rough * 0.75) * 0.9;

  var col = opaque;
  if (M.a.w > 0.01) {
    // ---- translucent: jelly, custard, caramel, coulis
    let px = vec2i(fragPos.xy);
    let front = -(u.view * vec4f(wp, 1.0)).z;
    let back = textureLoad(backLin, px, 0).r;
    let behind = textureLoad(sceneLin, px, 0).r;
    let thick = clamp(min(back, behind) - front, 0.05, 16.0);
    let vn = (u.view * vec4f(N, 0.0)).xyz;
    let uv0 = fragPos.xy * u.res.zw;
    let bend = 0.25 + 0.75 * smoothstep(0.0, 6.0, thick);
    let uvR = clamp(uv0 - vn.xy * vec2f(1.0, -1.0) * bend * 0.05, vec2f(0.001), vec2f(0.999));
    let behindR = textureLoad(sceneLin, vec2i(uvR * u.res.xy), 0).r;
    var bg = textureSampleLevel(sceneColor, sceneSampler, uvR, 0.0).rgb;
    if (behindR < front) { bg = textureSampleLevel(sceneColor, sceneSampler, uv0, 0.0).rgb; }
    let tint = max(M.t.rgb, vec3f(0.002));
    let sigma = -log(tint) * M.t.w;
    let absorb = exp(-sigma * thick);
    var tc = bg * absorb;
    let backlit = pow(max(dot(-V, L) * 0.5 + 0.5, 0.0), 2.0);
    let thin = exp(-thick * 0.35);
    let glow = tint * (0.18 + 0.55 * backlit * thin + 0.35 * pow(1.0 - NdV, 2.0) * thin);
    tc += glow * (1.0 - absorb * 0.6) * 0.7;
    let wrap = max(NdL * 0.6 + 0.4, 0.0);
    let milky = tint * (amb * 0.5 + vec3f(1.0, 0.98, 0.95) * wrap * 0.75) + tint * thin * 0.25;
    tc = mix(tc, milky, scatter);
    tc = mix(tc, envLight(R), F * 0.95);
    tc += vec3f(1.0, 0.98, 0.95) * ggx(N, V, L, max(rough, 0.05)) * max(NdL, 0.0) * 1.15;
    col = mix(opaque, tc, M.a.w);
  }
  return vec4f(toSrgb(col), 1.0);
}

@fragment fn fsJelly(i: VOut) -> @location(0) vec4f {
  return shadeJelly(i.wp, i.n, i.pos, i.rp);
}
`;

export const jellyShader = /* wgsl */ `
${common}
${jellySkin}
${jellyShade}

struct JIn {
  @location(0) rn: vec3f,
  @location(1) n0: vec4u,
  @location(2) n1: vec4u,
  @location(3) w0: vec4f,
  @location(4) w1: vec4f,
  @location(5) rp: vec3f,
};

@vertex fn vsJelly(i: JIn) -> VOut {
  let s = skin(i.rn, i.n0, i.n1, i.w0, i.w1);
  var o: VOut;
  o.wp = s.p;
  o.n = s.n;
  o.rp = i.rp;
  o.pos = u.viewProj * vec4f(s.p, 1.0);
  return o;
}

@vertex fn vsJellyShadow(i: JIn) -> @builtin(position) vec4f {
  let s = skin(i.rn, i.n0, i.n1, i.w0, i.w1);
  return u.lightViewProj * vec4f(s.p, 1.0);
}
`;

// The scooped bite rides rigidly on the spoon.
export const blobShader = /* wgsl */ `
${common}
struct Obj { model: mat4x4f, color: vec4f, params: vec4f };
@group(1) @binding(0) var<uniform> obj: Obj;
${jellyShade}

@vertex fn vsBlob(@location(0) p: vec3f, @location(1) n: vec3f) -> VOut {
  var o: VOut;
  let w = obj.model * vec4f(p, 1.0);
  o.wp = w.xyz;
  o.n = normalize((obj.model * vec4f(n, 0.0)).xyz);
  o.rp = p;
  o.pos = u.viewProj * w;
  return o;
}
@vertex fn vsBlobShadow(@location(0) p: vec3f, @location(1) n: vec3f) -> @builtin(position) vec4f {
  return u.lightViewProj * (obj.model * vec4f(p, 1.0));
}
`;

export const shadowObjShader = /* wgsl */ `
${common}
struct Obj { model: mat4x4f, color: vec4f, params: vec4f };
@group(1) @binding(0) var<uniform> obj: Obj;
@vertex fn vsShadow(@location(0) p: vec3f, @location(1) n: vec3f) -> @builtin(position) vec4f {
  return u.lightViewProj * (obj.model * vec4f(p, 1.0));
}
`;

export const compositeShader = /* wgsl */ `
${common}
@group(1) @binding(0) var sceneColor: texture_2d<f32>;
struct BOut { @builtin(position) pos: vec4f };
@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> BOut {
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: BOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  return o;
}
@fragment fn fsFull(i: BOut) -> @location(0) vec4f {
  let c = textureLoad(sceneColor, vec2i(i.pos.xy), 0).rgb;
  return vec4f(toSrgb(c), 1.0);
}
`;

export const meshLinesShader = /* wgsl */ `
${common}
@group(1) @binding(0) var<storage, read> nodePos: array<vec4f>;
@group(1) @binding(1) var<storage, read> nodeRot: array<vec4f>;
@group(1) @binding(2) var<storage, read> lineIdx: array<u32>;
@vertex fn vsLines(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let p = nodePos[lineIdx[vi]].xyz;
  return u.viewProj * vec4f(p, 1.0);
}
@fragment fn fsLines() -> @location(0) vec4f {
  return vec4f(1.0, 1.0, 1.0, 0.55);
}
`;
