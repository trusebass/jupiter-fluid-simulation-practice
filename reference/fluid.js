// Jupiter fluid
// ----------------------------------------------------------------------------
// A 2D incompressible fluid (stable fluids: semi-Lagrangian advection, Jacobi
// pressure projection, vorticity confinement) runs on the GPU. The photograph
// is never advected directly. Instead a displacement map d(x) is advected
// with the flow ("reference map" method):
//
//     d_new(x) = d(x - v dt) - v dt,        d <- d * exp(-k dt)
//
// and the screen shows image(x + d(x)). Because the image is sampled once per
// frame from the original texture, it stays sharp no matter how long the
// fluid runs, and the decay term k pulls every cloud back to where Juno saw it.
// ----------------------------------------------------------------------------

const DEFAULTS = {
  simRes: 64,               // velocity grid, cells on the short side; fewer = larger eddies
  mapRes: 448,              // displacement grid, cells on the short side
  pressureIterations: 22,
  pressureRetain: 0.8,
  velocityDissipation: 1.2, // 1/s
  viscosity: 20,            // 1/s, how fast ripples the size of one grid cell die out
  curl: 1.5,                // vorticity confinement strength; high values add small-scale wiggle
  relax: 0.15,              // 1/s, how fast the image returns
  splatRadius: 0.005,       // gaussian variance in (short side)^2 units
  force: 0.005,              // fraction of pointer velocity handed to the fluid
  ambient: 0.02,            // strength of the slow background drift
  stormGain: 0.6,           // how strongly circling a storm spins it up
  stormDecay: 1.6,          // s, spin time constant
  stormMaxSpin: 1.1,        // rad/s
  idleSpin: 0.5,           // rad/s, slow back-and-forth twist of each storm
  focus: [0.5, 0.5],        // CSS object-position of the photo, 0..1
  imageSize: [1920, 1630],
  storms: [],               // [{ x, y, r }] in image pixels
  maxDpr: 2,
};

const VERT = `#version 300 es
precision highp float;
in vec2 aPos;
uniform vec2 texel;
out vec2 vUv, vL, vR, vT, vB;
void main() {
  vUv = aPos * 0.5 + 0.5;
  vL = vUv - vec2(texel.x, 0.0);
  vR = vUv + vec2(texel.x, 0.0);
  vT = vUv + vec2(0.0, texel.y);
  vB = vUv - vec2(0.0, texel.y);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv, vL, vR, vT, vB;
out vec4 o;
`;

const FRAG = {
  advect: HEAD + `
uniform sampler2D uVelocity;
uniform vec2 texel;
uniform float dt, decay;
void main() {
  vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * texel;
  o = vec4(decay * texture(uVelocity, coord).xy, 0.0, 1.0);
}`,

  advectMap: HEAD + `
uniform sampler2D uVelocity, uMap;
uniform vec2 simTexel;
uniform float dt, keep;
void main() {
  vec2 step = dt * texture(uVelocity, vUv).xy * simTexel;
  vec2 d = texture(uMap, vUv - step).xy - step;
  o = vec4(d * keep, 0.0, 1.0);
}`,

  divergence: HEAD + `
uniform sampler2D uVelocity;
void main() {
  float L = texture(uVelocity, vL).x;
  float R = texture(uVelocity, vR).x;
  float T = texture(uVelocity, vT).y;
  float B = texture(uVelocity, vB).y;
  vec2 C = texture(uVelocity, vUv).xy;
  if (vL.x < 0.0) L = -C.x;
  if (vR.x > 1.0) R = -C.x;
  if (vT.y > 1.0) T = -C.y;
  if (vB.y < 0.0) B = -C.y;
  o = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`,

  curl: HEAD + `
uniform sampler2D uVelocity;
void main() {
  float L = texture(uVelocity, vL).y;
  float R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x;
  float B = texture(uVelocity, vB).x;
  o = vec4(0.5 * ((R - L) - (T - B)), 0.0, 0.0, 1.0);
}`,

  vorticity: HEAD + `
uniform sampler2D uVelocity, uCurl;
uniform float curl, dt;
void main() {
  float L = texture(uCurl, vL).x;
  float R = texture(uCurl, vR).x;
  float T = texture(uCurl, vT).x;
  float B = texture(uCurl, vB).x;
  float C = texture(uCurl, vUv).x;
  vec2 f = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  f /= length(f) + 1e-4;
  f *= curl * C;
  f.y *= -1.0;
  vec2 v = texture(uVelocity, vUv).xy + f * dt;
  o = vec4(clamp(v, -800.0, 800.0), 0.0, 1.0);
}`,

  pressure: HEAD + `
uniform sampler2D uPressure, uDivergence;
void main() {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  float div = texture(uDivergence, vUv).x;
  o = vec4(0.25 * (L + R + T + B - div), 0.0, 0.0, 1.0);
}`,

  gradient: HEAD + `
uniform sampler2D uPressure, uVelocity;
void main() {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  vec2 v = texture(uVelocity, vUv).xy - 0.5 * vec2(R - L, T - B);
  o = vec4(v, 0.0, 1.0);
}`,

  scale: HEAD + `
uniform sampler2D uTex;
uniform float value;
void main() { o = value * texture(uTex, vUv); }`,

  // Viscosity: blend each cell towards the average of its four neighbours.
  // A ripple one cell wide is wiped out quickly; a swirl many cells wide
  // barely changes, so the flow keeps only large, smooth structures.
  smooth: HEAD + `
uniform sampler2D uTex;
uniform float amount;
void main() {
  vec4 c = texture(uTex, vUv);
  vec4 avg = 0.25 * (texture(uTex, vL) + texture(uTex, vR) + texture(uTex, vT) + texture(uTex, vB));
  o = mix(c, avg, amount);
}`,

  splat: HEAD + `
uniform sampler2D uVelocity;
uniform vec2 point, force;
uniform float aspect, radius;
void main() {
  vec2 p = vUv - point;
  p.x *= aspect;
  float g = exp(-dot(p, p) / radius);
  o = vec4(texture(uVelocity, vUv).xy + force * g, 0.0, 1.0);
}`,

  // Background drift plus storm spin. The drift is the curl of a slowly
  // moving stream function, so it adds no divergence.
  forces: HEAD + `
uniform sampler2D uVelocity;
uniform vec4 storms[16];
uniform int stormCount;
uniform float aspect, cells, dt, time, ambient;
const float TAU = 6.2831853;
vec2 wave(vec2 p, vec2 dir, float len, float hz, float ph) {
  vec2 k = TAU / len * dir;
  float c = cos(dot(k, p) + TAU * hz * time + ph);
  return c * vec2(k.y, -k.x);
}
void main() {
  vec2 v = texture(uVelocity, vUv).xy;
  vec2 p = vec2(vUv.x * aspect, vUv.y);
  vec2 drift = wave(p, normalize(vec2(0.8, 0.6)), 0.95, 0.031, 0.0)
             + wave(p, normalize(vec2(-0.3, 1.0)), 0.71, 0.043, 1.7)
             + wave(p, normalize(vec2(1.0, -0.2)), 0.53, 0.057, 4.1)
             + wave(p, normalize(vec2(-0.7, -0.7)), 0.41, 0.071, 2.3);
  v += dt * ambient * drift;
  for (int i = 0; i < 16; i++) {
    if (i >= stormCount) break;
    vec4 s = storms[i];
    vec2 r = vUv - s.xy;
    r.x *= aspect;
    float g = exp(-dot(r, r) / (s.z * s.z));
    vec2 target = s.w * vec2(-r.y, r.x) * cells;
    float w = g * clamp(abs(s.w) * 1.5, 0.0, 1.0) * min(1.0, 6.0 * dt);
    v = mix(v, target, w);
  }
  o = vec4(v, 0.0, 1.0);
}`,

  display: HEAD + `
uniform sampler2D uMap, uImage;
uniform vec2 scale, offset;
void main() {
  vec2 uv = vUv + texture(uMap, vUv).xy;
  o = vec4(texture(uImage, uv * scale + offset).rgb, 1.0);
}`,
};

export function createJupiter(canvas, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const gl = canvas.getContext('webgl2', {
    alpha: false, depth: false, stencil: false, antialias: false,
    premultipliedAlpha: false, preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!gl) return null;
  gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('EXT_color_buffer_half_float');
  const fmtRG = pickFormat(gl, gl.RG16F, gl.RG) || pickFormat(gl, gl.RGBA16F, gl.RGBA);
  const fmtR = pickFormat(gl, gl.R16F, gl.RED) || fmtRG;
  if (!fmtRG) return null;

  // geometry: one triangle that covers the viewport
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const P = {};
  for (const [name, src] of Object.entries(FRAG)) P[name] = program(gl, vs, compile(gl, gl.FRAGMENT_SHADER, src));

  let W = 0, H = 0, sim, map, velocity, divergence, curlTex, pressure, mapFbo;
  let image = null, imageTex = null;
  let coverScale = [1, 1], coverOffset = [0, 0];
  const storms = cfg.storms.map((s, i) => ({
    ...s, u: 0, v: 0, rr: 0, spin: 0,
    period: 9 + ((i * 3.7) % 7),      // s
    phase: i * 2.399,                  // golden angle, so neighbours are out of step
  }));
  const moves = [];
  let raf = 0, running = false, last = 0, time = 0, ready = false;
  let onFirstFrame = null;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, cfg.maxDpr);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (w === W && h === H) return;
    W = canvas.width = w;
    H = canvas.height = h;
    sim = gridSize(cfg.simRes, w, h);
    map = gridSize(cfg.mapRes, w, h);
    for (const t of [velocity, divergence, curlTex, pressure, mapFbo]) t && t.dispose();
    velocity = doubleFbo(gl, sim, fmtRG);
    divergence = fbo(gl, sim, fmtR);
    curlTex = fbo(gl, sim, fmtR);
    pressure = doubleFbo(gl, sim, fmtR);
    mapFbo = doubleFbo(gl, map, fmtRG);
    updateCover();
  }

  function updateCover() {
    const [iw, ih] = cfg.imageSize;
    const ac = W / H, ai = iw / ih;
    const sx = ac > ai ? 1 : ac / ai;
    const sy = ac > ai ? ai / ac : 1;
    const fx = cfg.focus[0], fy = 1 - cfg.focus[1];
    coverScale = [sx, sy];
    coverOffset = [fx * (1 - sx), fy * (1 - sy)];
    for (const s of storms) {
      s.u = (s.x / iw - coverOffset[0]) / sx;
      s.v = (1 - s.y / ih - coverOffset[1]) / sy;
      s.rr = (s.r / ih) / sy; // radius in units of canvas height
    }
  }

  function setImage(img) {
    image = img;
    imageTex = imageTex || gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, imageTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    ready = true;
  }

  // Pointer input. x, y in CSS pixels relative to the canvas; t in ms.
  // Moves are queued and applied at the next frame.
  function pointer(x, y, t, isNew) {
    const p = { x, y, t };
    if (isNew || !pointer.last || t - pointer.last.t > 120) { pointer.last = p; return; }
    const prev = pointer.last;
    pointer.last = p;
    const dtMs = Math.max(4, t - prev.t);
    moves.push({ x0: prev.x, y0: prev.y, x1: x, y1: y, dt: dtMs / 1000 });
  }

  function applyMoves() {
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) { moves.length = 0; return; }
    const aspect = sim.w / sim.h;
    for (const m of moves) {
      const dxPx = m.x1 - m.x0, dyPx = m.y1 - m.y0;
      const speed = Math.hypot(dxPx, dyPx) / m.dt;            // CSS px/s
      if (speed < 1) continue;
      const s = Math.min(speed / 900, 3);                     // 0..3
      const gain = cfg.force * (0.55 + 0.45 * s);              // faster moves push harder
      const radius = cfg.splatRadius * (1 + 0.9 * Math.min(s, 1.6)) * (ch < 500 ? 1.3 : 1);
      // pointer velocity in sim cells per second
      const vx = (dxPx / cw) * sim.w / m.dt;
      const vy = (-dyPx / ch) * sim.h / m.dt;
      // spread long moves along the path so fast strokes leave a continuous wake
      const steps = Math.min(6, Math.max(1, Math.ceil(Math.hypot(dxPx, dyPx) / 28)));
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        const px = (m.x0 + dxPx * k) / cw, py = 1 - (m.y0 + dyPx * k) / ch;
        splat(px, py, (vx * gain) / steps * 1.6, (vy * gain) / steps * 1.6, radius, aspect);
      }
      spinStorms(m, cw, ch);
    }
    moves.length = 0;
  }

  // Circling a storm hands it angular momentum: the angle the pointer sweeps
  // around the storm's centre, weighted by how close the pointer passes.
  function spinStorms(m, cw, ch) {
    for (const s of storms) {
      const cx = s.u * cw, cy = (1 - s.v) * ch, R = s.rr * ch;
      const ax = m.x0 - cx, ay = m.y0 - cy, bx = m.x1 - cx, by = m.y1 - cy;
      const dist = Math.hypot(bx, by);
      if (dist > R * 1.8 || dist < 2) continue;
      let dTheta = Math.atan2(ax * by - ay * bx, ax * bx + ay * by); // screen y down
      dTheta = -dTheta;                                                // to y-up
      const near = Math.exp(-((dist / R) ** 2) * 0.6);
      s.spin += cfg.stormGain * dTheta * near;
      s.spin = Math.max(-cfg.stormMaxSpin, Math.min(cfg.stormMaxSpin, s.spin));
    }
  }

  function splat(x, y, fx, fy, radius, aspect) {
    use(P.splat, sim, {
      uVelocity: velocity.read, point: [x, y], force: [fx, fy], aspect, radius,
    }, velocity.write);
    velocity.swap();
  }

  function step(dt) {
    applyMoves();
    const aspect = sim.w / sim.h;
    const simTexel = [1 / sim.w, 1 / sim.h];

    const keepSpin = Math.exp(-dt / cfg.stormDecay);
    const stormData = new Float32Array(64);
    let n = 0;
    for (const s of storms) {
      s.spin *= keepSpin;
      if (Math.abs(s.spin) < 0.004) s.spin = 0;
      const idle = cfg.idleSpin * Math.sin((2 * Math.PI * time) / s.period + s.phase);
      const w = s.spin + idle;
      if (Math.abs(w) > 0.004 && n < 16) stormData.set([s.u, s.v, s.rr, w], 4 * n++);
    }
    use(P.forces, sim, {
      uVelocity: velocity.read, storms: stormData, stormCount: n, aspect,
      cells: sim.h, dt, time, ambient: cfg.ambient,
    }, velocity.write);
    velocity.swap();

    use(P.curl, sim, { uVelocity: velocity.read }, curlTex);
    use(P.vorticity, sim, { uVelocity: velocity.read, uCurl: curlTex.tex, curl: cfg.curl, dt }, velocity.write);
    velocity.swap();

    use(P.divergence, sim, { uVelocity: velocity.read }, divergence);
    use(P.scale, sim, { uTex: pressure.read, value: cfg.pressureRetain }, pressure.write);
    pressure.swap();
    for (let i = 0; i < cfg.pressureIterations; i++) {
      use(P.pressure, sim, { uPressure: pressure.read, uDivergence: divergence.tex }, pressure.write);
      pressure.swap();
    }
    use(P.gradient, sim, { uPressure: pressure.read, uVelocity: velocity.read }, velocity.write);
    velocity.swap();

    // The central differences above cannot see a checkerboard pattern, so
    // the projection never removes it; the smoothing pass does.
    use(P.smooth, sim, {
      uTex: velocity.read, amount: Math.min(0.5, 1 - Math.exp(-cfg.viscosity * dt)),
    }, velocity.write);
    velocity.swap();

    use(P.advect, sim, {
      uVelocity: velocity.read, dt, decay: Math.exp(-cfg.velocityDissipation * dt),
    }, velocity.write);
    velocity.swap();

    use(P.advectMap, map, {
      uVelocity: velocity.read, uMap: mapFbo.read, simTexel, dt, keep: Math.exp(-cfg.relax * dt),
    }, mapFbo.write);
    mapFbo.swap();
  }

  function render() {
    use(P.display, { w: W, h: H }, {
      uMap: mapFbo.read, uImage: imageTex, scale: coverScale, offset: coverOffset,
    }, null);
  }

  // Bind a program, set uniforms (textures get units in order), draw into target.
  function use(prog, size, uniforms, target) {
    gl.useProgram(prog.p);
    let unit = 0;
    if (prog.u.texel) gl.uniform2f(prog.u.texel, 1 / size.w, 1 / size.h);
    for (const [name, val] of Object.entries(uniforms)) {
      const info = prog.u[name];
      if (!info) continue;
      const tex = val && val.isTex ? val.tex : val instanceof WebGLTexture ? val : null;
      if (tex) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(info, unit++);
      } else if (name === 'stormCount') gl.uniform1i(info, val);
      else if (val instanceof Float32Array) gl.uniform4fv(info, val);
      else if (Array.isArray(val)) gl.uniform2f(info, val[0], val[1]);
      else gl.uniform1f(info, val);
    }
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    resize();
    if (!ready) return;
    const dt = Math.min(Math.max((now - last) / 1000, 0), 1 / 30);
    last = now;
    time += dt;
    step(dt);
    render();
    if (onFirstFrame) { const f = onFirstFrame; onFirstFrame = null; f(); }
  }

  // Advance the simulation without a display (used by tests and to warm up).
  function advance(seconds, fps = 60) {
    resize();
    const dt = 1 / fps;
    for (let t = 0; t < seconds; t += dt) { time += dt; step(dt); }
    render();
  }

  // Displacement statistics in canvas pixels (for tuning).
  function measure() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, mapFbo.read.fbo);
    const px = new Float32Array(map.w * map.h * 4);
    gl.readPixels(0, 0, map.w, map.h, gl.RGBA, gl.FLOAT, px);
    let max = 0, sum = 0;
    for (let i = 0; i < px.length; i += 4) {
      const m = Math.hypot(px[i] * W, px[i + 1] * H);
      sum += m; if (m > max) max = m;
    }
    return { max, mean: sum / (map.w * map.h) };
  }

  return {
    setImage,
    measure,
    pointer,
    advance,
    resize,
    get storms() { return storms; },
    set firstFrame(fn) { onFirstFrame = fn; },
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() { running = false; cancelAnimationFrame(raf); },
    destroy() {
      this.stop();
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    },
  };
}

function gridSize(res, w, h) {
  const a = w > h ? w / h : h / w;
  const lo = Math.round(res), hi = Math.round(res * a);
  return w > h ? { w: hi, h: lo } : { w: lo, h: hi };
}

function pickFormat(gl, internal, format) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, 4, 4, 0, format, gl.HALF_FLOAT, null);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);
  gl.deleteTexture(tex);
  return ok ? { internal, format } : null;
}

function fbo(gl, size, fmt) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, size.w, size.h, 0, fmt.format, gl.HALF_FLOAT, null);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.viewport(0, 0, size.w, size.h);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return {
    isTex: true, tex, fbo: fb, w: size.w, h: size.h,
    dispose() { gl.deleteTexture(tex); gl.deleteFramebuffer(fb); },
  };
}

function doubleFbo(gl, size, fmt) {
  let a = fbo(gl, size, fmt), b = fbo(gl, size, fmt);
  return {
    get read() { return a; },
    get write() { return b; },
    get tex() { return a.tex; },
    isTex: true,
    swap() { [a, b] = [b, a]; },
    dispose() { a.dispose(); b.dispose(); },
  };
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}
