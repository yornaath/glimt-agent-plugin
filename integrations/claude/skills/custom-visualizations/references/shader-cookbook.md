# Shader cookbook

Tested GLSL building blocks for custom visualizations: easing, noise, flow, colour, dithering, shapes, light, particles and trails. Use them instead of writing these from memory. Small mistakes in noise or colour maths don't fail loudly, they just look worse.

**How to use a snippet.**
- Copy it verbatim, **including its header and credit comment**, into the shader string of your module. The credits are licence requirements, not decoration. The full licence texts are at the end of this file.
- Copy everything its `@needs` line names first, in that order.
- Each snippet compiles in Glimt's sandbox: a test in the Glimt repo builds every one with its dependencies and fails on any compile error.

**The header** (the first comment lines of every `glsl` block):

| Field | Meaning |
|---|---|
| `@snippet` | The id. Everything the snippet defines starts with it, so snippets never collide. |
| `@needs` | Snippets that must come before it, or `none`. |
| `@stage` | `vertex`, `fragment` or `any`. Fragment-only snippets use `fwidth`, `gl_FragCoord` or `gl_PointCoord`. |
| `@use` | An example call. |
| `Credit:` | Author, work, and the licence of the code. |

Snippets contain no `#version`, `precision` or `uniform` lines; three.js's `ShaderMaterial` and your own declarations provide them.

**Licences.** Snippets are written from published algorithms and credited, or copied from code with a permissive licence that is named in the credit. Nothing here comes from LYGIA (its licence bars commercial use without sponsorship). Don't copy Shadertoy code unless the shader states MIT or CC0.

## Conventions

A full-screen shader with three.js. This is the shell the snippets go into, and what `examples/sdf-lotus-2d.js` does.

```js
const material = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },        // state.time % 3600 on the JS side: floats lose precision as time grows
    uLevel: { value: 0 },       // the glided breath level, 0 = out, 1 = in
    uResolution: { value: new THREE.Vector2(canvas.width, canvas.height) },
    uColor: { value: new THREE.Color("#6055F7") }, // THREE.Color stores linear RGB: use it directly in maths
  },
  transparent: true,
  premultipliedAlpha: true,     // blend as ONE, ONE_MINUS_SRC_ALPHA: the canvas is premultiplied
  depthTest: false,
  depthWrite: false,
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uLevel;
    uniform vec2 uResolution;
    uniform vec3 uColor;
    varying vec2 vUv;
    // … snippets here …
    void main() {
      vec3 color = uColor;   // straight (not premultiplied) linear colour
      float alpha = 1.0;
      gl_FragColor = vec4(color, alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      gl_FragColor.rgb *= gl_FragColor.a;                         // premultiply after the sRGB conversion
      gl_FragColor = ditherRgba(gl_FragColor, ign(gl_FragCoord.xy)); // dither last, in output space
    }
  `,
})
// Draw it with a 2×2 plane and any camera: the vertex shader ignores the matrices.
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material))
```

Rules that apply everywhere:
- **Linear in, sRGB out.** Do colour maths in linear RGB (or OKLab), then `#include <colorspace_fragment>` converts for the screen. Forgetting it makes colours too dark. Converting twice makes them washed out.
- **Premultiply last.** The canvas holds premultiplied colour. Multiply `rgb` by `a` after the colour space conversion, never before.
- **Dither last.** Quantisation to 8 bits happens on output, so dither the final value (`ditherRgba`). Soft glows on dark backgrounds band without it.
- **Wrap time.** Pass `state.time % 3600` (or larger) as `uTime`. After hours, raw seconds lose the precision that slow drift needs. Keep motion periodic or seamless across the wrap, e.g. noise at low speed.
- **Edges from `fwidth`.** Anti-alias with `aaFill`, so edges stay one pixel soft at every size, including 220 px.

## Breath curves

The breath level itself comes from `state` on the JS side, glided into `uLevel`. All the examples use this glide:

```js
// Frame-rate independent glide towards a target; rate ≈ 1 / seconds to settle. Credit: Glimt. MIT.
const approach = (current, target, dt, rate) => current + (target - current) * (1 - Math.exp(-rate * dt))
// In render(): dt from state.time, clamped to [0, 0.1], never negative.
const dt = Math.min(Math.max(state.time - lastTime, 0), 0.1)
lastTime = state.time
level = approach(level, breathLevel(phase, state.progress), dt, 12)
```

Inside a shader, shape `uLevel` (or a per-pixel delay of it) with these.

`easeSine` is the same ease the examples use on the JS side. Use it for anything that should start and stop softly. One `cos`.

```glsl
// @snippet easeSine
// @needs none
// @stage any
// @use float v = easeSine(fract(uTime * 0.25));
// Credit: Glimt. MIT.
float easeSine(float t) {
  return 0.5 - 0.5 * cos(3.14159265 * clamp(t, 0.0, 1.0));
}
```

`smootherstep` has zero first and second derivatives at the ends, so motion built on it never visibly jerks. Use it for slow reveals. It costs slightly more than `smoothstep`.

```glsl
// @snippet smootherstep
// @needs none
// @stage any
// @use float v = smootherstep(0.2, 0.8, vUv.x);
// Credit: Ken Perlin, "Improving Noise" (SIGGRAPH 2002), the 6t⁵ − 15t⁴ + 10t³ curve. Glimt code. MIT.
float smootherstep(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}
```

`breathAsym` is a breath-like cycle for secondary motion, with a faster rise and a longer fall: shimmer, ripples or petals that lag behind. **Never drive the main breath with it**; that comes from `uLevel`.

```glsl
// @snippet breathAsym
// @needs easeSine
// @stage any
// @use float v = breathAsym(uTime * 0.1, 0.4);
// Credit: Glimt. MIT.
float breathAsym(float t, float riseShare) {
  t = fract(t);
  return t < riseShare ? easeSine(t / riseShare) : 1.0 - easeSine((t - riseShare) / (1.0 - riseShare));
}
```

## Hashes and noise

Hashes give repeatable pseudo-random values from a position, with no texture and no `sin` precision problems. Use them for seeds, sparkle, per-cell variation and dithering. A few multiplies each. Feed them large-ish, non-integer coordinates. On small integer grids, scale the input first.

```glsl
// @snippet hash12
// @needs none
// @stage any
// @use float v = hash12(vUv * 640.0);
// Credit: Dave Hoskins, "Hash without Sine" (shadertoy.com/view/4djSRW). MIT, Copyright (c) 2014 David Hoskins.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
```

```glsl
// @snippet hash22
// @needs none
// @stage any
// @use vec2 v = hash22(vUv * 512.0);
// Credit: Dave Hoskins, "Hash without Sine" (shadertoy.com/view/4djSRW). MIT, Copyright (c) 2014 David Hoskins.
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
```

```glsl
// @snippet hash33
// @needs none
// @stage any
// @use vec3 v = hash33(vec3(vUv * 512.0, uTime));
// Credit: Dave Hoskins, "Hash without Sine" (shadertoy.com/view/4djSRW). MIT, Copyright (c) 2014 David Hoskins.
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
```

`mod289` holds the permutation helpers that the simplex noises below share. You won't call it yourself.

```glsl
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
```

`snoise2` is 2D simplex noise, from −1 to 1, with smooth, organic variation and no grid artefacts. It's the workhorse for flat, full-screen effects. About 30 operations a call. Speed it up by scaling the input, never by adding octaves.

```glsl
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
```

`snoise3grad` is 3D simplex noise, from −1 to 1, that also returns its exact gradient. Use the third axis for slow time evolution. The gradient gives you normals for bumps and curl flow, for free. About 80 operations a call.

```glsl
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
```

`snoise3` is the same noise without the gradient. The unused gradient maths costs a little; drivers usually remove it once the call is inlined.

```glsl
// @snippet snoise3
// @needs snoise3grad
// @stage any
// @use float v = snoise3(vec3(vUv * 3.0, uTime * 0.1));
// Credit: Ian McEwan, Stefan Gustavson (Ashima Arts), webgl-noise (github.com/stegu/webgl-noise). MIT, Copyright (C) 2011 by Ashima Arts, Copyright (C) 2011-2016 by Stefan Gustavson.
float snoise3(vec3 v) {
  vec3 gradient;
  return snoise3grad(v, gradient);
}
```

`fbm2` and `fbm3` are fractal noise: five octaves of simplex, each rotated so the octaves don't line up, from about −1 to 1. Use them for clouds, mist, water and anything with detail at several scales. The cost is 5 noise calls a pixel. Drop octaves before dropping resolution: at 220 px the fifth octave is invisible.

```glsl
// @snippet fbm2
// @needs snoise2
// @stage any
// @use float v = fbm2(vUv * 3.0 + uTime * 0.03);
// Credit: Inigo Quilez, "fbm" (iquilezles.org/articles/fbm), rotated octaves. Glimt code. MIT.
float fbm2(vec2 p) {
  const mat2 rotation = mat2(0.8, -0.6, 0.6, 0.8);
  float sum = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += amplitude * snoise2(p);
    p = rotation * p * 2.02;
    amplitude *= 0.5;
  }
  return sum;
}
```

```glsl
// @snippet fbm3
// @needs snoise3
// @stage any
// @use float v = fbm3(vec3(vUv * 3.0, uTime * 0.05));
// Credit: Inigo Quilez, "fbm" (iquilezles.org/articles/fbm), rotated octaves. Glimt code. MIT.
float fbm3(vec3 p) {
  const mat3 rotation = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
  float sum = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += amplitude * snoise3(p);
    p = rotation * p * 2.02;
    amplitude *= 0.5;
  }
  return sum;
}
```

`warp2` is domain warping: fbm sampled at a position that is itself displaced by fbm. It gives the marbled, flowing look of ink, aurora and silk. `strength` around 2 to 4. At 3 fbm calls (15 noise calls) a pixel, it's the most expensive snippet here. Keep it to one layer, and render it into a half-resolution target when it's full screen.

```glsl
// @snippet warp2
// @needs fbm2
// @stage any
// @use float v = warp2(vUv * 2.0, uTime * 0.05, 3.0);
// Credit: Inigo Quilez, "domain warping" (iquilezles.org/articles/warp). Glimt code. MIT.
float warp2(vec2 p, float t, float strength) {
  vec2 q = vec2(fbm2(p + vec2(0.0, t)), fbm2(p + vec2(5.2, 1.3 - t)));
  return fbm2(p + strength * q);
}
```

## Flow

`curl3` is a divergence-free velocity field: particles that follow it swirl without bunching up or thinning out, like smoke. It's the heart of `examples/smoke-flow-gpgpu.js`. It costs 3 `snoise3grad` calls, so use it per particle in a GPGPU pass, not per pixel at full screen.

```glsl
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
```

## Colour

`cosPalette` is a smooth palette from four vectors: `a + b·cos(2π(c·t + d))`. It's ideal for slow shimmer and iridescence. Keep `b` small for calm colour. One `cos` per channel.

```glsl
// @snippet cosPalette
// @needs none
// @stage any
// @use vec3 v = cosPalette(vUv.x, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));
// Credit: Inigo Quilez, "palettes" (iquilezles.org/articles/palettes), the formula. Glimt code. MIT.
vec3 cosPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318530718 * (c * t + d));
}
```

OKLab is a perceptual colour space: mixing in it keeps brightness and hue even, where mixing linear RGB goes muddy or dips in the middle. Mixing violet to white through it stays violet. Converting both ways costs about two matrix multiplies and three cube roots. The input is linear RGB, as `THREE.Color` stores it.

```glsl
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
```

```glsl
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
```

`oklabMix` blends two linear RGB colours through OKLab. For a fixed gradient, convert the two ends once on the JS side or in the vertex shader, and only `mix` plus `oklabToLinear` per pixel.

```glsl
// @snippet oklabMix
// @needs linearToOklab oklabToLinear
// @stage any
// @use vec3 v = oklabMix(vec3(0.08, 0.06, 0.6), vec3(0.92, 0.9, 1.0), vUv.y);
// Credit: Glimt, on Björn Ottosson's OKLab. MIT.
vec3 oklabMix(vec3 a, vec3 b, float t) {
  return oklabToLinear(mix(linearToOklab(a), linearToOklab(b), t));
}
```

## Banding

Smooth gradients in 8-bit output show steps, worst in faint glows on dark backgrounds. The fix is a tiny, well-distributed noise added just before output. The harness that tests the examples fails modules that band.

`ign` is interleaved gradient noise: a cheap per-pixel value in [0, 1) that is evenly spread at every scale. It's better than a hash for dithering. Feed it `gl_FragCoord.xy`, never UVs.

```glsl
// @snippet ign
// @needs none
// @stage fragment
// @use float v = ign(gl_FragCoord.xy);
// Credit: Jorge Jimenez, "Next Generation Post Processing in Call of Duty: Advanced Warfare" (SIGGRAPH 2014), the algorithm. Glimt code. MIT.
float ign(vec2 pixel) {
  return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}
```

`ditherRgb` adds triangular noise of ±1 output level, which removes visible steps without visible grain. `ditherRgba` dithers alpha the same way: use it whenever a glow fades out by alpha on the transparent canvas, which is most of them. Apply it **after** `colorspace_fragment` and premultiplying. In a post-processing chain, dither in the last effect instead. The composer converts to sRGB after it, so dither in sRGB terms and convert back, as `GlowAlphaEffect` in `examples/glow-orb-postprocessing.js` does: near black, a linear dither of one level turns into a dozen.

```glsl
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
```

```glsl
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
```

## Shapes

Signed distance functions (SDFs): negative inside, positive outside, in the same units as `p`. Work in a centred space scaled by the short side, `vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);`, so shapes keep their proportions at every aspect ratio. Turn a distance into pixels with `aaFill` and `sdfGlow`. Every SDF costs a handful of operations, so dozens a pixel are fine.

`rot2` rotates a point counter-clockwise by `angle` radians: `rot2(a) * p`. Petal rings and mandalas are one shape drawn at several rotations.

```glsl
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
```

```glsl
// @snippet sdCircle
// @needs none
// @stage any
// @use float v = sdCircle(vUv - 0.5, 0.3);
// Credit: Inigo Quilez, "2D distance functions" (iquilezles.org/articles/distfunctions2d). Glimt code. MIT.
float sdCircle(vec2 p, float radius) {
  return length(p) - radius;
}
```

```glsl
// @snippet sdRing
// @needs none
// @stage any
// @use float v = sdRing(vUv - 0.5, 0.3, 0.02);
// Credit: Inigo Quilez, "2D distance functions" (iquilezles.org/articles/distfunctions2d), annular shape. Glimt code. MIT.
float sdRing(vec2 p, float radius, float thickness) {
  return abs(length(p) - radius) - 0.5 * thickness;
}
```

```glsl
// @snippet sdRoundBox
// @needs none
// @stage any
// @use float v = sdRoundBox(vUv - 0.5, vec2(0.3, 0.2), 0.05);
// Credit: Inigo Quilez, "2D distance functions" (iquilezles.org/articles/distfunctions2d). Glimt code. MIT.
float sdRoundBox(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}
```

`sdVesica` is the pointed oval where two circles of `radius`, `offset` apart from the centre, overlap. The points face up and down. `sdPetal` builds on it.

```glsl
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
```

`sdEgg` is round at the bottom (`radiusBottom`) and narrower at the top (`radiusTop`). Use it for seeds, buds and drops.

```glsl
// @snippet sdEgg
// @needs none
// @stage any
// @use float v = sdEgg(vUv - 0.5, 0.25, 0.1);
// Credit: Inigo Quilez, "2D distance functions" (iquilezles.org/articles/distfunctions2d), egg. Glimt code. MIT.
float sdEgg(vec2 p, float radiusBottom, float radiusTop) {
  const float k = 1.7320508;
  p.x = abs(p.x);
  float r = radiusBottom - radiusTop;
  return ((p.y < 0.0) ? length(p) - r
        : (k * (p.x + r) < p.y) ? length(vec2(p.x, p.y - k * r))
        : length(vec2(p.x + r, p.y)) - 2.0 * r) - radiusTop;
}
```

`sdPetal` is a pointed petal with its base at the origin, reaching `petalLength` up the +y axis, `petalWidth` across at the middle. Rotate `p` with `rot2` for each petal of a ring. The length must be at least the width.

```glsl
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
```

```glsl
// @snippet sdStar5
// @needs none
// @stage any
// @use float v = sdStar5(vUv - 0.5, 0.3, 0.45);
// Credit: Inigo Quilez, "2D distance functions" (iquilezles.org/articles/distfunctions2d), five-pointed star. Glimt code. MIT.
float sdStar5(vec2 p, float radius, float innerRatio) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-0.809016994375, -0.587785252292);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= radius;
  vec2 ba = innerRatio * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, radius);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
```

`opSmoothUnion` merges two distances with a soft fillet of size `k`, as if they were liquid. Use it for metaballs and petals that grow from one base. With `k` near 0 it's a plain `min`.

```glsl
// @snippet opSmoothUnion
// @needs none
// @stage any
// @use float v = opSmoothUnion(length(vUv - 0.4) - 0.1, length(vUv - 0.6) - 0.1, 0.1);
// Credit: Inigo Quilez, "smooth minimum" (iquilezles.org/articles/smin), polynomial version. Glimt code. MIT.
float opSmoothUnion(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
```

`aaFill` turns a distance into coverage with an edge exactly one pixel soft at any size, from the screen-space derivative. Without it, edges are jagged at 220 px and blurry at 1024 px. Fragment only.

```glsl
// @snippet aaFill
// @needs none
// @stage fragment
// @use float v = aaFill(length(vUv - 0.5) - 0.3);
// Credit: Glimt, the standard fwidth anti-aliasing for distance fields. MIT.
float aaFill(float d) {
  float width = max(fwidth(d), 1e-5);
  return clamp(0.5 - d / width, 0.0, 1.0);
}
```

`sdfGlow` gives a soft light that falls off outside a shape, 1 at the edge. `falloff` is in 1 / distance units: 8 to 20 is a gentle halo in short-side units. Always dither a glow (`ditherRgba`).

```glsl
// @snippet sdfGlow
// @needs none
// @stage any
// @use float v = sdfGlow(length(vUv - 0.5) - 0.3, 12.0);
// Credit: Glimt. MIT.
float sdfGlow(float d, float falloff) {
  return exp(-max(d, 0.0) * falloff);
}
```

## Light

For surfaces of three.js meshes in your own `ShaderMaterial`, as in `examples/three-orb.js`.

`fresnelSchlick` is the reflectance that rises towards grazing angles: the bright rim of glass, water and soap bubbles. `cosTheta` is `dot(normal, viewDir)`. `f0` is about 0.04 for glass and water.

```glsl
// @snippet fresnelSchlick
// @needs none
// @stage any
// @use float v = fresnelSchlick(vUv.x, 0.04);
// Credit: Christophe Schlick, "An Inexpensive BRDF Model for Physically-based Rendering" (1994), the approximation. Glimt code. MIT.
float fresnelSchlick(float cosTheta, float f0) {
  return f0 + (1.0 - f0) * pow(1.0 - clamp(cosTheta, 0.0, 1.0), 5.0);
}
```

`wrapDiffuse` is diffuse light that wraps past the terminator, a cheap stand-in for light scattering through a soft, milky body. `wrap` 0 is Lambert; 0.5 is soft.

```glsl
// @snippet wrapDiffuse
// @needs none
// @stage any
// @use float v = wrapDiffuse(vUv.y * 2.0 - 1.0, 0.5);
// Credit: Simon Green, "Real-Time Approximations to Subsurface Scattering" (GPU Gems, 2004), wrap lighting. Glimt code. MIT.
float wrapDiffuse(float nDotL, float wrap) {
  return max((nDotL + wrap) / (1.0 + wrap), 0.0);
}
```

three.js's physical material already does glass, iridescence and sheen well. It needs an environment to reflect, and `RoomEnvironment` from `three/addons` gives one without loading any files:

```js
// requires = ["three", "three/addons"]. Credit: three.js examples. MIT.
// Build the environment ONCE in create(): PMREM takes seconds on software GPUs.
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new addons.RoomEnvironment(), 0.04).texture
pmrem.dispose()

const glass = new THREE.MeshPhysicalMaterial({ transmission: 1, thickness: 0.6, roughness: 0.08, ior: 1.4, color: "#f1efff" })
const bubble = new THREE.MeshPhysicalMaterial({ transmission: 1, thickness: 0.1, roughness: 0, iridescence: 1, iridescenceIOR: 1.3 })
const velvet = new THREE.MeshPhysicalMaterial({ color: "#4613C7", roughness: 0.9, sheen: 1, sheenColor: "#bdb6fb", sheenRoughness: 0.5 })
// Dispose scene.environment, materials and geometry in dispose().
```

## Particles

`pointSize` gives the size in pixels for a `THREE.Points` sprite of world size `size` at `viewDepth` (`-mvPosition.z`). `projectionScale` is `uResolution.y * projectionMatrix[1][1] * 0.5`, so sprites keep their world size at any canvas size and dpr. Clamp the result: huge sprites near the camera are where fill rate goes.

```glsl
// @snippet pointSize
// @needs none
// @stage any
// @use float v = pointSize(0.05, 2.0 + uTime, 400.0);
// Credit: Glimt, the perspective point size three.js's PointsMaterial uses. MIT.
float pointSize(float size, float viewDepth, float projectionScale) {
  return size * projectionScale / max(viewDepth, 1e-3);
}
```

`softSprite` is a round, soft particle from `gl_PointCoord`, 1 in the middle and 0 at the rim. Combined with `AdditiveBlending`, it gives glowing dust. Fragment only.

```glsl
// @snippet softSprite
// @needs none
// @stage fragment
// @use float v = softSprite(gl_PointCoord);
// Credit: Glimt. MIT.
float softSprite(vec2 pointCoord) {
  float d = clamp(1.0 - length(pointCoord - 0.5) * 2.0, 0.0, 1.0);
  return d * d * (3.0 - 2.0 * d);
}
```

Thousands of particles move best on the GPU: positions and velocities live in float textures that a fragment shader updates each frame. `GPUComputationRenderer` from `three/addons` does the ping-pong for you. `examples/smoke-flow-gpgpu.js` is the complete version.

```js
// requires = ["three", "three/addons"].
// Credit: the technique as taught by Edan Kwan and Bruno Simon; GPUComputationRenderer from three.js examples, MIT.
const SIDE = 128 // 16,384 particles
const gpu = new addons.GPUComputationRenderer(SIDE, SIDE, renderer)
// Float targets need EXT_color_buffer_float; half floats work almost everywhere.
if (!renderer.extensions.has("EXT_color_buffer_float")) gpu.setDataType(THREE.HalfFloatType)
const position = gpu.createTexture() // fill position.image.data (RGBA per particle) from a seeded hash
const velocity = gpu.createTexture()
const positionVar = gpu.addVariable("texturePosition", positionShader, position)
const velocityVar = gpu.addVariable("textureVelocity", velocityShader, velocity)
gpu.setVariableDependencies(positionVar, [positionVar, velocityVar])
gpu.setVariableDependencies(velocityVar, [positionVar, velocityVar])
velocityVar.material.uniforms.uTime = { value: 0 }
const error = gpu.init()
if (error) throw new Error(error) // e.g. no float render targets at all
// Each frame: set uniforms, gpu.compute(), then give the Points material
// gpu.getCurrentRenderTarget(positionVar).texture to read in its vertex shader.
// dispose(): gpu.dispose() plus the textures, geometry and materials.
```

## Trails

`feedbackFade` blends the new frame over a faded copy of the previous one, for trails and afterglow. Store the previous frame in a `HalfFloatType` target. In 8 bits, small fades get stuck and leave ghosts, which is why the snippet also subtracts half a level each frame.

```glsl
// @snippet feedbackFade
// @needs none
// @stage any
// @use vec4 v = feedbackFade(vec4(vUv, 0.0, 1.0), vec4(0.2), 0.95);
// Credit: Glimt. MIT.
vec4 feedbackFade(vec4 previous, vec4 current, float fade) {
  vec4 trail = max(previous * fade - vec4(0.5 / 255.0), 0.0);
  return current + trail * (1.0 - current.a); // premultiplied "over"
}
```

The ping-pong setup that goes with it. It replaces `AfterimagePass`, which isn't available in the sandbox:

```js
// Credit: Glimt. MIT.
const options = { type: THREE.HalfFloatType, depthBuffer: false }
let read = new THREE.WebGLRenderTarget(width, height, options)
let write = read.clone()
const scene = new THREE.Scene() // what you draw this frame, rendered into `current`
const current = new THREE.WebGLRenderTarget(width, height, options)
const blend = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { tPrevious: { value: null }, tCurrent: { value: current.texture }, uFade: { value: 0.94 } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
  fragmentShader: `uniform sampler2D tPrevious; uniform sampler2D tCurrent; uniform float uFade; varying vec2 vUv;
    /* feedbackFade snippet here */
    void main() { gl_FragColor = feedbackFade(texture2D(tPrevious, vUv), texture2D(tCurrent, vUv), uFade); }`,
}))
const blendScene = new THREE.Scene().add(blend)
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
// Each frame:
renderer.setRenderTarget(current); renderer.clear(); renderer.render(scene, sceneCamera)
blend.material.uniforms.tPrevious.value = read.texture
renderer.setRenderTarget(write); renderer.render(blendScene, camera)
renderer.setRenderTarget(null); /* draw write.texture to the canvas, e.g. with a copy quad */
;[read, write] = [write, read]
// On resize: setSize on all three targets and clear them. A fade of 0.94 at 60 fps leaves a trail of about a second.
```

## Post-processing

Bloom makes bright parts glow past their edges. Both libraries have it. Bloom in both adds light to RGB only, so on the transparent canvas the glow vanishes on light backgrounds unless a last step turns it into alpha. `references/libraries.md` has the full recipe and the reasons.

Bloom with pmndrs `postprocessing`, as `examples/glow-orb-postprocessing.js` does. This is the tested path, so prefer it:

```js
// requires = ["three", "postprocessing"]. Credit: pmndrs/postprocessing, Zlib; Glimt, MIT.
const { EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode } = postprocessing
renderer.setClearColor(0x000000, 0)
renderer.toneMapping = THREE.NoToneMapping // the composer tone maps
const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType })
composer.addPass(new RenderPass(scene, camera))
// Threshold just above the brightest thing that should NOT glow; make what should glow brighter than white.
const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.92, luminanceSmoothing: 0.08, intensity: 0.6, radius: 0.6, resolutionScale: 0.5 })
// GlowAlphaEffect: copy it from the example. It sets alpha to the brightest channel and dithers.
composer.addPass(new EffectPass(camera, bloom, new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }), new GlowAlphaEffect()))
// render(): bloom.intensity = 0.5 + 0.7 * level; composer.render(dt)
// resize(): renderer.setPixelRatio(dpr); composer.setSize(width, height, false)
// dispose(): composer.dispose() disposes passes and effects; then geometry, materials, renderer.
```

Bloom with `three/addons`, if you need its passes:

```js
// requires = ["three", "three/addons"]. Credit: three.js examples. MIT.
const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType })
const composer = new addons.EffectComposer(renderer, target)
composer.addPass(new addons.RenderPass(scene, camera))
const bloom = new addons.UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.6, 0.5, 0.9) // strength, radius, threshold
composer.addPass(bloom)
// A ShaderPass here that sets alpha from the brightest channel, as GlowAlphaEffect does.
composer.addPass(new addons.OutputPass()) // tone mapping and sRGB conversion, last
// render(): bloom.strength = 0.4 + 0.6 * level; composer.render()
// resize(): composer.setSize(width, height); composer.setPixelRatio(dpr)
```

Checklist for any post chain:
- Clear to transparent, and use half float buffers.
- Pick `ToneMappingMode.NEUTRAL` to keep whites white. `AGX` greys and desaturates bright colours.
- Preview on `"background": "light"`. A grey or black box means a pass dropped alpha. A glow that's missing on light means bloom lives only in RGB.
- Keep blurry effects at half resolution, and skip MSAA unless the design has hard edges: on float buffers it can cost more than everything else.

## Budget

Approximate cost per pixel. At full screen on a 4K display with dpr 2, the canvas can be 8 MP or more, while a typical laptop GPU manages roughly 2,000 to 4,000 noise calls per pixel per second at 1 MP before it gets warm. Stay well within it: these run for whole sessions.

| Technique | Cost per pixel | Notes |
|---|---|---|
| SDF shapes, `aaFill`, `sdfGlow`, palettes | a few to ~50 operations | Dozens of shapes are fine |
| `snoise2` | ~30 operations | |
| `snoise3` / `snoise3grad` | ~80 operations | |
| `fbm2` / `fbm3` (5 octaves) | 5 noise calls | Use 3 to 4 octaves below 400 px |
| `warp2` | 15 noise calls | Half resolution at full screen |
| Bloom (mipmap blur, half res) | ~10 texture reads | One per composer |
| GPGPU particles | per particle, not per pixel | 16k cheap, 65k moderate; additive fill is the real cost |

Practices:
- **Cap the expensive pass.** Render a heavy shader into a `WebGLRenderTarget` capped near 1 MP (`scale = Math.min(1, Math.sqrt(1e6 / (w * h)))`) and draw it scaled up. Keep the canvas at `size.dpr`.
- **Constant loop bounds.** `for (int i = 0; i < 5; i++)`. Use `break` for early exit, never a uniform-length loop.
- **Precision.** Keep `highp` for positions, time and noise input. `mediump` is only safe for colour maths.
- **Measure.** Read the preview's whole-frame time and full screen estimate (see `references/mcp-tools.md`) after every change that touches a shader.

## Licences

Snippets credited "Glimt" are MIT licensed by Glimt. Snippets that implement a published algorithm credit its authors; the code is Glimt's. Two sources are copied code under the MIT licence, with these notices:

- `hash12`, `hash22`, `hash33`: Copyright (c) 2014 David Hoskins.
- `mod289`, `snoise2`, `snoise3grad`, `snoise3`: Copyright (C) 2011 by Ashima Arts (simplex noise), Copyright (C) 2011-2016 by Stefan Gustavson.

Each under these terms:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The OKLab matrices (`linearToOklab`, `oklabToLinear`) are from Björn Ottosson's post, which places its code in the public domain, with MIT as an alternative.
