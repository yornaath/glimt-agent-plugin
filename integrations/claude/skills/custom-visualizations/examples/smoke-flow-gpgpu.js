// Violet smoke of 16,384 glowing particles. Breathing in gathers it into a
// softly turning sphere; breathing out lets it loosen and drift on a slow,
// swirling current. The reference for GPGPU: positions and velocities live in
// float textures, updated on the GPU each frame by GPUComputationRenderer.
//
// The current is curl noise, which swirls without bunching particles up.
// Techniques and snippets from references/shader-cookbook.md, credited inline.
// Cost: two 128×128 simulation passes (3 noise calls a particle) and 16,384
// small additive sprites. Measured in Glimt's test harness, which renders on
// the CPU (SwiftShader): 2.4 ms a frame at 480×480 and 4.2 ms at
// 1024×1024, including GPU work. In Glimt on a Windows desktop GPU: 0.7 ms at
// 1024×1024, estimated 3.6 ms at a 3840×2160 full screen.
//
// 256×256 (65,536 particles) also works on most GPUs, but only go there when
// renderer.capabilities.maxTextureSize and the preview's full screen estimate
// allow it: additive fill is the real cost.

export const requires = ["three", "three/addons"]

const SIDE = 128
const COUNT = SIDE * SIDE

const ease = (t) => 0.5 - Math.cos(Math.PI * t) / 2

/** How full of air the user is: 0 = fully exhaled, 1 = fully inhaled. */
function breathLevel(phase, progress) {
  switch (phase.type) {
    case "inhale": return ease(progress)
    case "hold-in": return 1
    case "exhale": return 1 - ease(progress)
    case "hold-out": return 0
  }
}

/** Frame-rate independent glide; `rate` ≈ 1 / seconds to settle. */
const approach = (current, target, dt, rate) => current + (target - current) * (1 - Math.exp(-rate * dt))

/** A seeded generator, 0 → 1. Never Math.random: previews must repeat. */
function seeded(seed) {
  return () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) / 4294967296
  }
}

const velocityShader = /* glsl */ `
  uniform float uTime;
  uniform float uDt;
  uniform float uLevel;
  uniform sampler2D tTarget;

  // @snippet mod289
  // @needs none
  // @stage any
  // @use vec4 v = mod289Permute(vec4(vUv, uTime, 1.0));
  // Credit: Ian McEwan, Stefan Gustavson (Ashima Arts), webgl-noise (github.com/stegu/webgl-noise). MIT, Copyright (C) 2011 by Ashima Arts, Copyright (C) 2011-2016 by Stefan Gustavson.
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 mod289Permute(vec3 x) { return mod289(((x * 34.0) + 10.0) * x); }
  vec4 mod289Permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
  vec4 mod289TaylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  // @snippet snoise3grad
  // @needs mod289
  // @stage any
  // @use vec3 g; float v = snoise3grad(vec3(vUv * 3.0, uTime * 0.1), g) + g.x;
  // Credit: Ian McEwan, Stefan Gustavson (Ashima Arts), webgl-noise (github.com/stegu/webgl-noise), with the analytic gradient. MIT, Copyright (C) 2011 by Ashima Arts, Copyright (C) 2011-2016 by Stefan Gustavson.
  float snoise3grad(vec3 v, out vec3 gradient) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = mod289Permute(mod289Permute(mod289Permute(
               i.z + vec4(0.0, i1.z, i2.z, 1.0))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0))
             + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = mod289TaylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    vec4 m2 = m * m;
    vec4 m4 = m2 * m2;
    vec4 pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
    vec4 temp = m2 * m * pdotx;
    gradient = -8.0 * (temp.x * x0 + temp.y * x1 + temp.z * x2 + temp.w * x3);
    gradient += m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
    gradient *= 105.0;
    return 105.0 * dot(m4, pdotx);
  }

  // @snippet curl3
  // @needs snoise3grad
  // @stage any
  // @use vec3 v = curl3(vec3(vUv, 0.0) * 2.0, uTime * 0.1);
  // Credit: Robert Bridson, Jim Hourihan, Marcus Nordenstam, "Curl-noise for procedural fluid flow" (SIGGRAPH 2007), the algorithm. Glimt code. MIT.
  vec3 curl3(vec3 p, float t) {
    vec3 gx;
    vec3 gy;
    vec3 gz;
    snoise3grad(p + vec3(0.0, 0.0, t), gx);
    snoise3grad(p + vec3(31.416, -47.853, 12.679 + t), gy);
    snoise3grad(p + vec3(-233.1, 17.37, -61.5 + t), gz);
    // curl of the potential (nx, ny, nz), from the analytic gradients
    return vec3(gz.y - gy.z, gx.z - gz.x, gy.x - gx.y);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec3 position = texture2D(texturePosition, uv).xyz;
    vec3 velocity = texture2D(textureVelocity, uv).xyz;
    vec3 target = texture2D(tTarget, uv).xyz;

    // Where the smoke wants to go. Out: it rides the current, on a soft leash past radius 0.6.
    // In: it gathers onto the sphere while the current calms.
    float flow = mix(0.22, 0.04, uLevel);
    vec3 desired = curl3(position * 0.8, uTime * 0.07) * flow;
    desired += (target - position) * 4.0 * uLevel;
    desired -= position * max(length(position) - 0.6, 0.0) * 3.0;
    // The velocity eases towards that, damped 0.96 a frame at 60 fps, so the smoke never jerks or overshoots.
    velocity = mix(desired, velocity, pow(0.96, uDt * 60.0));
    gl_FragColor = vec4(velocity, 1.0);
  }
`

const positionShader = /* glsl */ `
  uniform float uDt;

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec3 position = texture2D(texturePosition, uv).xyz;
    vec3 velocity = texture2D(textureVelocity, uv).xyz;
    gl_FragColor = vec4(position + velocity * uDt, 1.0);
  }
`

const pointsVertexShader = /* glsl */ `
  uniform sampler2D tPosition;
  uniform sampler2D tVelocity;
  uniform float uSize;
  uniform float uProjectionScale;
  uniform vec3 uSlow;
  uniform vec3 uFast;
  attribute vec2 reference;
  varying vec3 vColor;

  // @snippet pointSize
  // @needs none
  // @stage any
  // @use float v = pointSize(0.05, 2.0 + uTime, 400.0);
  // Credit: Glimt, the perspective point size three.js's PointsMaterial uses. MIT.
  float pointSize(float size, float viewDepth, float projectionScale) {
    return size * projectionScale / max(viewDepth, 1e-3);
  }

  // @snippet linearToOklab
  // @needs none
  // @stage any
  // @use vec3 v = linearToOklab(vec3(vUv, 0.5));
  // Credit: Björn Ottosson, "A perceptual color space for image processing" (bottosson.github.io/posts/oklab), the matrices. Public domain, or MIT.
  float linearToOklabCbrt(float x) { return sign(x) * pow(abs(x), 1.0 / 3.0); }
  vec3 linearToOklab(vec3 c) {
    float l = linearToOklabCbrt(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b);
    float m = linearToOklabCbrt(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b);
    float s = linearToOklabCbrt(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
    return vec3(
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
  }

  // @snippet oklabToLinear
  // @needs none
  // @stage any
  // @use vec3 v = oklabToLinear(vec3(0.7, 0.05, -0.1));
  // Credit: Björn Ottosson, "A perceptual color space for image processing" (bottosson.github.io/posts/oklab), the matrices. Public domain, or MIT.
  vec3 oklabToLinear(vec3 c) {
    float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
    float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
    float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
    l = l * l * l;
    m = m * m * m;
    s = s * s * s;
    return vec3(
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
  }

  // @snippet oklabMix
  // @needs linearToOklab oklabToLinear
  // @stage any
  // @use vec3 v = oklabMix(vec3(0.08, 0.06, 0.6), vec3(0.92, 0.9, 1.0), vUv.y);
  // Credit: Glimt, on Björn Ottosson's OKLab. MIT.
  vec3 oklabMix(vec3 a, vec3 b, float t) {
    return oklabToLinear(mix(linearToOklab(a), linearToOklab(b), t));
  }

  void main() {
    vec3 position = texture2D(tPosition, reference).xyz;
    float speed = length(texture2D(tVelocity, reference).xyz);
    // Slow smoke is deep violet, fast smoke pale lilac, mixed in OKLab.
    vColor = oklabMix(uSlow, uFast, smoothstep(0.02, 0.35, speed));
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = clamp(pointSize(uSize, -viewPosition.z, uProjectionScale), 1.0, 32.0);
  }
`

const pointsFragmentShader = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;

  // @snippet softSprite
  // @needs none
  // @stage fragment
  // @use float v = softSprite(gl_PointCoord);
  // Credit: Glimt. MIT.
  float softSprite(vec2 pointCoord) {
    float d = clamp(1.0 - length(pointCoord - 0.5) * 2.0, 0.0, 1.0);
    return d * d * (3.0 - 2.0 * d);
  }

  void main() {
    gl_FragColor = vec4(vColor, softSprite(gl_PointCoord) * uOpacity);
    #include <colorspace_fragment>
    gl_FragColor.rgb *= gl_FragColor.a; // premultiplied, so additive light keeps alpha valid
  }
`

export default function create({ canvas, size, THREE, addons }) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" })
  renderer.setClearColor(0x000000, 0) // transparent background
  renderer.setPixelRatio(size.dpr)
  renderer.setSize(size.width, size.height, false) // false: an OffscreenCanvas has no CSS size to set
  // three.js only logs shader errors; throw so they reach last_error instead of leaving a blank area.
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    throw new Error("Shader failed: " + (gl.getShaderInfoLog(fs) || gl.getShaderInfoLog(vs) || gl.getProgramInfoLog(program) || "").trim())
  }

  // --- Simulation -----------------------------------------------------------

  const gpu = new addons.GPUComputationRenderer(SIDE, SIDE, renderer)
  // Float render targets need EXT_color_buffer_float; half floats work almost everywhere.
  if (!renderer.extensions.has("EXT_color_buffer_float")) gpu.setDataType(THREE.HalfFloatType)

  /** Writes one RGBA texel, as floats or half floats, whichever the texture holds. */
  const write = (data, i, x, y, z) => {
    const values = [x, y, z, 1]
    for (let c = 0; c < 4; c++) data[i * 4 + c] = data instanceof Uint16Array ? THREE.DataUtils.toHalfFloat(values[c]) : values[c]
  }

  // Start in a soft shell around the middle, at rest.
  const random = seeded(0x2545f491)
  const initialPosition = gpu.createTexture()
  const initialVelocity = gpu.createTexture()
  for (let i = 0; i < COUNT; i++) {
    const z = random() * 2 - 1
    const angle = random() * Math.PI * 2
    const radius = 0.6 + 0.4 * Math.cbrt(random())
    const ring = Math.sqrt(1 - z * z) * radius
    write(initialPosition.image.data, i, Math.cos(angle) * ring, Math.sin(angle) * ring, z * radius)
    write(initialVelocity.image.data, i, 0, 0, 0)
  }

  // Where each particle goes on the inhale: a point on a sphere's surface, sampled once.
  const sphere = new THREE.IcosahedronGeometry(0.55, 4)
  const sampler = new addons.MeshSurfaceSampler(new THREE.Mesh(sphere)).setRandomGenerator(seeded(0x6b43a9b5)).build()
  const targets = new Float32Array(COUNT * 4)
  const point = new THREE.Vector3()
  for (let i = 0; i < COUNT; i++) {
    sampler.sample(point)
    targets.set([point.x, point.y, point.z, 1], i * 4)
  }
  sphere.dispose()
  const targetTexture = new THREE.DataTexture(targets, SIDE, SIDE, THREE.RGBAFormat, THREE.FloatType)
  targetTexture.needsUpdate = true

  const positionVariable = gpu.addVariable("texturePosition", positionShader, initialPosition)
  const velocityVariable = gpu.addVariable("textureVelocity", velocityShader, initialVelocity)
  gpu.setVariableDependencies(positionVariable, [positionVariable, velocityVariable])
  gpu.setVariableDependencies(velocityVariable, [positionVariable, velocityVariable])
  const simulation = { uTime: { value: 0 }, uDt: { value: 0 }, uLevel: { value: 0 }, tTarget: { value: targetTexture } }
  Object.assign(velocityVariable.material.uniforms, simulation)
  positionVariable.material.uniforms.uDt = simulation.uDt
  const error = gpu.init()
  if (error) throw new Error(error)

  /** Back to the starting shell, e.g. when time jumps back on a remount or a fresh preview. */
  const reset = () => {
    for (const variable of [positionVariable, velocityVariable]) {
      for (const target of variable.renderTargets) gpu.renderTexture(variable.initialValueTexture, target)
    }
  }

  // --- Particles ------------------------------------------------------------

  const geometry = new THREE.BufferGeometry()
  const reference = new Float32Array(COUNT * 2)
  for (let i = 0; i < COUNT; i++) reference.set([((i % SIDE) + 0.5) / SIDE, (Math.floor(i / SIDE) + 0.5) / SIDE], i * 2)
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3)) // unused, sets the count
  geometry.setAttribute("reference", new THREE.BufferAttribute(reference, 2))

  const uniforms = {
    tPosition: { value: null },
    tVelocity: { value: null },
    uSize: { value: 0.018 },
    uProjectionScale: { value: 1 },
    uOpacity: { value: 0.32 },
    // THREE.Color stores linear RGB, which is what the shader's maths expects.
    uSlow: { value: new THREE.Color("#4F46CE") },
    uFast: { value: new THREE.Color("#b9b0ff") },
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: pointsVertexShader,
    fragmentShader: pointsFragmentShader,
    transparent: true,
    premultipliedAlpha: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false // positions come from a texture, so the bounding sphere is meaningless
  points.position.y = 0.12 // a little above the middle, so the lower fifth, where the app draws its labels, stays calm

  const scene = new THREE.Scene()
  scene.add(points)
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 20)
  camera.position.z = 3.2

  /** Fits the cloud to the short side, and keeps sprites a constant world size at any canvas size. */
  function fit() {
    const aspect = canvas.width / canvas.height
    camera.aspect = aspect
    // 40° across the short side, whichever it is.
    camera.fov = aspect >= 1 ? 40 : (2 * Math.atan(Math.tan((20 * Math.PI) / 180) / aspect) * 180) / Math.PI
    camera.updateProjectionMatrix()
    uniforms.uProjectionScale.value = canvas.height * camera.projectionMatrix.elements[5] * 0.5
  }
  fit()

  let level = 0
  let lastTime = 0

  return {
    render(sequences, state) {
      const phase = sequences[state.sequenceIndex]?.sequence[state.seq]?.phases[state.phase]
      if (!phase) return

      if (state.time < lastTime) reset()
      const dt = Math.min(Math.max(state.time - lastTime, 0), 0.1) // never negative: that would blow the glide up to NaN
      lastTime = state.time
      level = approach(level, breathLevel(phase, state.progress), dt, 12)

      simulation.uTime.value = state.time % 3600 // floats lose precision as time grows
      simulation.uDt.value = dt
      simulation.uLevel.value = level
      gpu.compute()

      uniforms.tPosition.value = gpu.getCurrentRenderTarget(positionVariable).texture
      uniforms.tVelocity.value = gpu.getCurrentRenderTarget(velocityVariable).texture
      points.rotation.y = state.time * 0.05
      renderer.render(scene, camera)
    },

    resize(next) {
      renderer.setPixelRatio(next.dpr)
      renderer.setSize(next.width, next.height, false)
      fit()
    },

    dispose() {
      gpu.dispose() // the simulation's render targets and materials
      initialPosition.dispose()
      initialVelocity.dispose()
      targetTexture.dispose()
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    },
  }
}
