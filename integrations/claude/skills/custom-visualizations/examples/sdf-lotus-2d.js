// A lotus of soft, milky petals that opens as you breathe in and folds back
// into a bud as you breathe out, with a gentle violet halo. One full-screen
// fragment shader: 17 petal distance fields layered back to front, OKLab
// colour, fwidth edges and dithering. The reference for full-screen shaders.
//
// Techniques and snippets from references/shader-cookbook.md, credited inline.
// Cost: 17 small SDFs, one noise call and one OKLab conversion a pixel.
// Measured in Glimt's test harness, which renders on the CPU (SwiftShader):
// 7 ms a frame at 480×480 and 34 ms at 1024×1024, including GPU work. A real
// GPU is many times faster; check the preview's full screen estimate.

export const requires = ["three"]

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

const vertexShader = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uTip;
  varying vec3 vBaseLab;
  varying vec3 vTipLab;

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

  void main() {
    // The petal gradient's ends in OKLab, converted once per vertex instead of per pixel.
    vBaseLab = linearToOklab(uBase);
    vTipLab = linearToOklab(uTip);
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  uniform float uLag;
  uniform vec2 uResolution;
  uniform vec3 uEdge;
  uniform vec3 uDeep;
  uniform vec3 uGlow;
  varying vec3 vBaseLab;
  varying vec3 vTipLab;

  // @snippet rot2
  // @needs none
  // @stage any
  // @use mat2 v = rot2(uTime);
  // Credit: Glimt. MIT.
  mat2 rot2(float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return mat2(c, s, -s, c);
  }

  // @snippet sdVesica
  // @needs none
  // @stage any
  // @use float v = sdVesica(vUv - 0.5, 0.4, 0.3);
  // Credit: Inigo Quilez, "2D distance functions" (iquilezles.org/articles/distfunctions2d), vesica. Glimt code. MIT.
  float sdVesica(vec2 p, float radius, float offset) {
    p = abs(p);
    float b = sqrt(radius * radius - offset * offset);
    return ((p.y - b) * offset > p.x * b) ? length(p - vec2(0.0, b)) : length(p - vec2(-offset, 0.0)) - radius;
  }

  // @snippet sdPetal
  // @needs sdVesica
  // @stage any
  // @use float v = sdPetal(vUv - vec2(0.5, 0.1), 0.6, 0.25);
  // Credit: Glimt. MIT.
  float sdPetal(vec2 p, float petalLength, float petalWidth) {
    // The vesica whose height is the petal's length and width its width.
    float s = petalLength * petalLength / (2.0 * petalWidth);
    float radius = 0.5 * (s + 0.5 * petalWidth);
    float offset = 0.5 * (s - 0.5 * petalWidth);
    return sdVesica(p - vec2(0.0, 0.5 * petalLength), radius, offset);
  }

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

  // @snippet snoise2
  // @needs mod289
  // @stage any
  // @use float v = snoise2(vUv * 4.0 + uTime * 0.05);
  // Credit: Ian McEwan, Stefan Gustavson (Ashima Arts), webgl-noise (github.com/stegu/webgl-noise). MIT, Copyright (C) 2011 by Ashima Arts, Copyright (C) 2011-2016 by Stefan Gustavson.
  float snoise2(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = mod289Permute(mod289Permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  // @snippet cosPalette
  // @needs none
  // @stage any
  // @use vec3 v = cosPalette(vUv.x, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));
  // Credit: Inigo Quilez, "palettes" (iquilezles.org/articles/palettes), the formula. Glimt code. MIT.
  vec3 cosPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(6.28318530718 * (c * t + d));
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

  // @snippet aaFill
  // @needs none
  // @stage fragment
  // @use float v = aaFill(length(vUv - 0.5) - 0.3);
  // Credit: Glimt, the standard fwidth anti-aliasing for distance fields. MIT.
  float aaFill(float d) {
    float width = max(fwidth(d), 1e-5);
    return clamp(0.5 - d / width, 0.0, 1.0);
  }

  // @snippet sdfGlow
  // @needs none
  // @stage any
  // @use float v = sdfGlow(length(vUv - 0.5) - 0.3, 12.0);
  // Credit: Glimt. MIT.
  float sdfGlow(float d, float falloff) {
    return exp(-max(d, 0.0) * falloff);
  }

  // @snippet ign
  // @needs none
  // @stage fragment
  // @use float v = ign(gl_FragCoord.xy);
  // Credit: Jorge Jimenez, "Next Generation Post Processing in Call of Duty: Advanced Warfare" (SIGGRAPH 2014), the algorithm. Glimt code. MIT.
  float ign(vec2 pixel) {
    return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
  }

  // @snippet ditherRgb
  // @needs none
  // @stage any
  // @use vec3 v = ditherRgb(vec3(vUv, 0.5), fract(vUv.x * 640.0));
  // Credit: Glimt, triangular-PDF dither as described by Mikkel Gjøl, "Banding in Games: A Noisy Rant" (Playdead, 2016). MIT.
  vec3 ditherRgb(vec3 color, float noise) {
    float n = noise * 2.0 - 1.0;
    n = sign(n) * (1.0 - sqrt(1.0 - abs(n))); // uniform to triangular, −1 … 1
    return color + n / 255.0;
  }

  // @snippet ditherRgba
  // @needs ditherRgb
  // @stage any
  // @use vec4 v = ditherRgba(vec4(vUv, 0.5, 0.5), fract(vUv.x * 640.0));
  // Credit: Glimt. MIT.
  vec4 ditherRgba(vec4 color, float noise) {
    vec3 rgb = ditherRgb(color.rgb, noise);
    // The same offset on alpha keeps premultiplied colour valid (rgb ≤ a).
    return clamp(vec4(rgb, color.a + (rgb.r - color.r)), 0.0, 1.0);
  }

  /** Premultiplied "over". */
  vec4 over(vec4 top, vec4 bottom) {
    return top + bottom * (1.0 - top.a);
  }

  /**
   * One ring of petals fanning up from the base, layered from the outside in so
   * the middle petals overlap the outer ones. 8 in front and 9 behind, at the
   * same spacing, so the two rings interleave.
   *
   * Petals are layered as parameters rather than colours, so the colour maths
   * runs once a pixel instead of once a petal: x is how far along its petal the
   * pixel is, y how deep its colour, z how much violet rim, w coverage.
   * Premultiplied, so "over" mixes them at the edges like colours.
   * nearest collects the distance to the flower, for the halo.
   */
  vec4 petalRing(vec2 p, int count, float spread, float petalLength, float petalWidth, float depth, vec4 layers, inout float nearest) {
    float n = float(count);
    for (int j = 0; j < 9; j++) {
      if (j >= count) break;
      int k = j / 2;
      int i = (j - k * 2 == 0) ? k : count - 1 - k; // outermost first: 0, n-1, 1, n-2, …
      float position = (2.0 * float(i) + 1.0 - n) / 8.0; // -1 … 1 across the fan
      vec2 q = rot2(position * spread) * p;
      float d = sdPetal(q, petalLength, petalWidth);
      nearest = min(nearest, d);
      // A soft rim inside each petal keeps overlapping petals apart, then a thin edge, one pixel soft at every size.
      float rim = mix(0.35 * (1.0 - smoothstep(0.0, 0.035, -d)), 0.8, aaFill(abs(d) - 0.003));
      vec4 petal = vec4(clamp(q.y / petalLength, 0.0, 1.0), depth * (0.2 + 0.3 * abs(position)), rim, 1.0);
      layers = over(petal * aaFill(d), layers);
    }
    return layers;
  }

  void main() {
    float side = min(uResolution.x, uResolution.y);
    // Centred, short side = 1. The lotus sits a little above the middle, so the lower fifth stays calm.
    vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / side - vec2(0.0, 0.05);
    vec2 base = p - vec2(0.0, -0.16);

    // Inhale opens the fans and lengthens the petals. The back ring follows a little later, for depth.
    float nearest = 1e5;
    vec4 layers = vec4(0.0);
    layers = petalRing(base, 9, mix(0.36, 1.35, uLag), mix(0.30, 0.41, uLag), mix(0.075, 0.10, uLag), 1.0, layers, nearest);
    layers = petalRing(base, 8, mix(0.30, 1.15, uLevel), mix(0.29, 0.39, uLevel), mix(0.075, 0.10, uLevel), 0.4, layers, nearest);

    // Milky body: violet at the base to near-white at the tip, mixed in OKLab, deepened and rimmed per petal.
    vec3 look = layers.xyz / max(layers.w, 1e-5);
    vec3 body = oklabToLinear(mix(vBaseLab, vTipLab, smoothstep(-0.1, 0.55, look.x)));
    body = mix(mix(body, uDeep, look.y), uEdge, look.z);
    vec4 color = vec4(body, 1.0) * layers.w;

    // A faint, slow shimmer over the petals.
    float shimmer = snoise2(p * 3.0 + uTime * 0.05) * 0.5 + 0.5;
    color.rgb = mix(color.rgb, cosPalette(shimmer, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67)) * color.a, 0.05);

    // The halo goes behind everything and swells with the breath.
    float halo = sdfGlow(nearest, 14.0) * (0.25 + 0.35 * uLevel);
    color = over(color, vec4(uGlow, 1.0) * halo);

    // Straight colour for the colour space chunk, premultiplied again after it, dithered last.
    gl_FragColor = vec4(color.rgb / max(color.a, 1e-5), color.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb *= gl_FragColor.a;
    gl_FragColor = ditherRgba(gl_FragColor, ign(gl_FragCoord.xy));
  }
`

export default function create({ canvas, size, THREE }) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" })
  renderer.setClearColor(0x000000, 0) // transparent background
  renderer.setPixelRatio(size.dpr)
  renderer.setSize(size.width, size.height, false) // false: an OffscreenCanvas has no CSS size to set
  // three.js only logs shader errors; throw so they reach last_error instead of leaving a blank area.
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    throw new Error("Shader failed: " + (gl.getShaderInfoLog(fs) || gl.getShaderInfoLog(vs) || gl.getProgramInfoLog(program) || "").trim())
  }

  const uniforms = {
    uTime: { value: 0 },
    uLevel: { value: 0 },
    uLag: { value: 0 },
    uResolution: { value: new THREE.Vector2(canvas.width, canvas.height) },
    // THREE.Color stores linear RGB, which is what the shader's maths expects.
    uBase: { value: new THREE.Color("#4F46CE") },
    uTip: { value: new THREE.Color("#f6f4ff") },
    uEdge: { value: new THREE.Color("#6055F7") },
    uDeep: { value: new THREE.Color("#4613C7") },
    uGlow: { value: new THREE.Color("#6055F7") },
  }

  // One triangle that covers the whole canvas: cheaper than a quad, with no diagonal seam.
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    premultipliedAlpha: true, // the shader writes premultiplied colour
    depthTest: false,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(mesh)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  let level = 0
  let lag = 0
  let lastTime = 0

  return {
    render(sequences, state) {
      const phase = sequences[state.sequenceIndex]?.sequence[state.seq]?.phases[state.phase]
      if (!phase) return

      const dt = Math.min(Math.max(state.time - lastTime, 0), 0.1) // never negative: that would blow the glide up to NaN
      lastTime = state.time
      level = approach(level, breathLevel(phase, state.progress), dt, 12)
      lag = approach(lag, level, dt, 4)

      uniforms.uTime.value = state.time % 3600 // floats lose precision as time grows
      uniforms.uLevel.value = level
      uniforms.uLag.value = lag
      renderer.render(scene, camera)
    },

    resize(next) {
      renderer.setPixelRatio(next.dpr)
      renderer.setSize(next.width, next.height, false)
      uniforms.uResolution.value.set(canvas.width, canvas.height) // device pixels, like gl_FragCoord
    },

    dispose() {
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    },
  }
}
