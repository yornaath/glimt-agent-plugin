# Libraries

What a module can `require`, what each library offers inside Glimt's sandbox, and what was left out on purpose. Before writing a module, call `get_visualization_capabilities`: it lists what the user's Glimt actually has (see `references/mcp-tools.md`). This file describes sandbox API version 2. Older versions of Glimt have only `three`.

```js
export const requires = ["three", "three/addons", "postprocessing"]
export default function create({ canvas, size, THREE, addons, postprocessing }) { … }
```

| `requires` | Context key | Version | What it is |
|---|---|---|---|
| `three` | `THREE` | 0.186.1 | three.js itself, exactly `import * as THREE from "three"` |
| `three/addons` | `addons` | 0.186.1 | A curated set of three.js's example modules (`three/examples/jsm`) |
| `postprocessing` | `postprocessing` | 6.39.5 | pmndrs postprocessing: an effect composer with merged effect passes |

- **Dependencies come along.** `requires = ["postprocessing"]` also provides `THREE`. List what you use anyway, for readers.
- **One three.js.** All libraries share the same instance, so `instanceof THREE.Mesh` and three's internal state work across them.
- **Loaded on demand.** Each library is fetched only when a module requires it. three.js is about 1.3 MB, addons 165 KB and postprocessing 435 KB, so require only what you use.
- **`THREE` is unguarded**, as it always was: `THREE.Something` is `undefined` when it doesn't exist, so feature checks like `if (THREE.Timer)` keep working.
- **`addons` and `postprocessing` are guarded.** Reading a name they don't have throws an error that says why, and what to use instead:
  `addons.OrbitControls isn't available in Glimt's sandbox. A visualization receives no input.`
  An unknown name lists everything available. These errors land in the preview summary and in `last_error`.

## `three/addons`

| Group | Exports |
|---|---|
| GPGPU | `GPUComputationRenderer` |
| Composer and passes | `EffectComposer`, `RenderPass`, `ShaderPass`, `OutputPass`, `Pass`, `FullScreenQuad`, `TexturePass`, `ClearPass`, `SavePass`, `UnrealBloomPass`, `FXAAPass`, `BokehPass`, `FilmPass` |
| Shaders (for `ShaderPass`) | `CopyShader`, `LuminosityHighPassShader`, `HorizontalBlurShader`, `VerticalBlurShader` |
| Lighting and shapes | `RoomEnvironment`, `MarchingCubes`, `MeshSurfaceSampler` |
| Noise on the CPU | `SimplexNoise`, `ImprovedNoise` |
| Wide lines | `Line2`, `LineSegments2`, `LineGeometry`, `LineSegmentsGeometry`, `LineMaterial` |
| Geometry | `RoundedBoxGeometry`, `ParametricGeometry` |
| Namespaces | `ParametricFunctions` (`addons.ParametricFunctions.klein`, `mobius`, `mobius3d`, `plane`), `BufferGeometryUtils` (`addons.BufferGeometryUtils.mergeVertices(…)`) |

Notes:
- `MeshSurfaceSampler` uses `Math.random` unless you call `.setRandomGenerator(seededFunction)`. Do, so previews repeat (`examples/smoke-flow-gpgpu.js`).
- `PMREMGenerator.fromScene(new addons.RoomEnvironment())` is slow on software GPUs, seconds rather than milliseconds. Build it once in `create()`, never per frame.
- `LineMaterial` needs `material.resolution.set(canvas.width, canvas.height)`, and again in `resize`.

**Unavailable in `addons`**, with the reason the guard gives:

| Export | Why, and what to use instead |
|---|---|
| `AfterimagePass` | It reads `window.innerWidth`, which a worker doesn't have. Fade the previous frame from a feedback render target instead (shader cookbook, Trails). |
| `SMAAPass` | It decodes its lookup textures with `Image`, which a worker doesn't have. Use `FXAAPass`, or MSAA with `samples: 4` on the composer's render target. |
| `OrbitControls` | A visualization receives no input. |
| `GLTFLoader` | The sandbox has no network and no files. Build geometry in code. |
| `TextureLoader` | The sandbox has no network and no files. Make textures with `DataTexture` or `CanvasTexture`. |
| `FontLoader` | The sandbox has no network and no files. Draw text on a 2D `OffscreenCanvas` and use it as a `CanvasTexture`. |
| `TextGeometry` | It needs a font file. Draw text on a 2D `OffscreenCanvas` and use it as a `CanvasTexture`. |
| `CSS2DRenderer`, `CSS3DRenderer` | A worker has no DOM. |
| `Lensflare` | It needs texture files. |

Everything else in `three/examples/jsm` isn't bundled. If you need something that isn't listed, write it inline. The sandbox can't load more.

## `postprocessing`

pmndrs postprocessing merges any number of effects into one full-screen pass, which makes it cheaper than chaining `addons` passes. Its own documentation applies, with the exceptions below. Everything ending in `Effect` builds and renders in the sandbox (Glimt's tests check each one):

`BloomEffect`, `SelectiveBloomEffect`, `ToneMappingEffect`, `FXAAEffect`, `VignetteEffect`, `NoiseEffect`, `ChromaticAberrationEffect`, `HueSaturationEffect`, `BrightnessContrastEffect`, `ColorAverageEffect`, `ColorDepthEffect`, `SepiaEffect`, `DepthOfFieldEffect`, `BokehEffect`, `TiltShiftEffect`, `GodRaysEffect`, `OutlineEffect`, `SSAOEffect`, `ShockWaveEffect`, `LensDistortionEffect`, `PixelationEffect`, `DotScreenEffect`, `GridEffect`, `ScanlineEffect`, `GlitchEffect`, `TextureEffect`, `DepthEffect`, `LUT1DEffect`, `LUT3DEffect`.

The passes (`RenderPass`, `EffectPass`, `CopyPass`, `KawaseBlurPass`, `MipmapBlurPass`, `GaussianBlurPass`, `ShaderPass`, `LambdaPass`, …), materials, enums (`BlendFunction`, `ToneMappingMode`, `KernelSize`, …) and the `Effect` base class for your own effects are all available too. `get_visualization_capabilities` lists all 118 exports.

Notes:
- Calming effects only. `GlitchEffect`, `ShockWaveEffect` and fast `NoiseEffect` flicker, which a breathing guide must not do.
- `LookupTexture.scaleUp()` starts a worker, which the sandbox blocks. Build lookup textures at the size you need.
- Subclassing `Effect` works: `class MyEffect extends postprocessing.Effect { constructor() { super("MyEffect", fragmentShader, { blendFunction: BlendFunction.SRC }) } }`. `examples/glow-orb-postprocessing.js` has one.

**Unavailable in `postprocessing`:**

| Export | Why, and what to use instead |
|---|---|
| `SMAAEffect` | It decodes its lookup textures with `Image`, which a worker doesn't have, so it would silently do nothing. Use `FXAAEffect`, or `new EffectComposer(renderer, { multisampling: 4 })`. |
| `SMAAImageLoader` | It needs `Image`. Use `FXAAEffect` or multisampling. |
| `SMAAImageGenerator` | It starts a nested worker, which the sandbox blocks. Use `FXAAEffect` or multisampling. |
| `ASCIIEffect`, `ASCIITexture` | They draw glyphs with `document.createElement("canvas")`, which a worker doesn't have. |
| `LUT3dlLoader`, `LUTCubeLoader` | The sandbox has no network and no files. Build a `LookupTexture` from data. |
| `GammaCorrectionEffect` | It's deprecated, and its shader doesn't compile with this three.js. The composer already outputs sRGB; for contrast use `BrightnessContrastEffect` or `ToneMappingEffect`. |
| `RealisticBokehEffect` | It's deprecated, and its shader doesn't compile with this three.js. Use `DepthOfFieldEffect`. |

## Keeping the background transparent through post

Post-processing renders into its own buffers and then onto the canvas. That's where transparency usually breaks. Bloom in both libraries adds light to RGB only, so alpha stays 0 around a glowing object. On the dark background the glow still shows, because the canvas adds it. On the light one it vanishes.

The recipe that `examples/glow-orb-postprocessing.js` uses, and that Glimt's tests check on both backgrounds:
1. `renderer.setClearColor(0x000000, 0)`, and the composer on half float buffers: `new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType })`.
2. Tone mapping inside the composer (`ToneMappingEffect`), with `renderer.toneMapping = THREE.NoToneMapping`. `ToneMappingMode.NEUTRAL` keeps a milky white white; `AGX` turns it grey.
3. A last effect that sets alpha to the brightest channel, so the glow becomes visible premultiplied colour, and dithers. It works in sRGB terms because the composer converts to sRGB after it. Copy `GlowAlphaEffect` from the example.
4. Preview on `"background": "light"`. A grey or black box means something dropped alpha; a vanished glow means step 3 is missing.

With `addons`, the same idea applies as a final `ShaderPass` before `OutputPass`. The tested example is the pmndrs one, so prefer it.

**Bloom only what should glow.** `BloomEffect` blooms everything brighter than `luminanceThreshold`. A milky white body has a luminance near 0.9, while saturated violet has only about 0.16. To get a violet glow instead of a white haze, set the threshold just above the body (0.92) and make the glowing part brighter than white in the shader, which the half float buffers allow (the example's `uGlow`).

## GPU budget

The preview reports the whole frame time, including the GPU, and estimates it at the user's largest full screen canvas (`references/mcp-tools.md`). Aim for an average under 4 ms at 1024×1024 on the user's machine, and an estimate well under 16 ms. Costs, roughly:

| Technique | Relative cost | Notes |
|---|---|---|
| 2D canvas shapes and gradients | lowest | Pre-render soft gradients once per size (`examples/breathing-circle-2d.js`) |
| A mesh with a custom shader | low | Cost follows the pixels it covers |
| Full-screen fragment shader | per pixel | Count snippets: see the cookbook's Budget table |
| `BloomEffect` (mipmap blur, half resolution) | moderate | One per composer; `resolutionScale: 0.5` |
| MSAA on float buffers | moderate to high | On weak GPUs it can cost more than the scene; the soft looks Glimt favours rarely need it |
| `FXAAEffect` | low to moderate | One full-screen pass |
| GPGPU, 16k particles | low | Simulation is per particle; additive sprites cost fill |
| GPGPU, 65k particles | moderate | Check `maxTextureSize` and the full screen estimate first |
| `PMREMGenerator` + `RoomEnvironment` | high once | Build in `create()`, never per frame |

What the examples measure, whole frame including GPU work:

| Example | Real GPU (Windows desktop), 1024×1024 | Its estimate at 3840×2160 full screen | Software GPU (Glimt's tests), 1024×1024 |
|---|---|---|---|
| `sdf-lotus-2d.js` | 0.7 ms | 3.9 ms | 34 ms |
| `smoke-flow-gpgpu.js` | 0.7 ms | 3.6 ms | 4 ms |
| `glow-orb-postprocessing.js` | 0.9 ms | 4.8 ms | 39 ms |
| `three-orb.js` | | | 5 ms |

The software GPU distorts relative costs: per-pixel shaders and post-processing look far more expensive there than on real hardware. Trust the preview on the user's own machine. A laptop's integrated GPU can be several times slower than this desktop's.

## macOS (WebKit)

On macOS, Glimt runs in WKWebView, which is WebKit; on Windows it's WebView2 (Chromium). Glimt's test suite runs every example in Chromium. Its WebKit run needs a Mac, because Playwright's WebKit builds for Windows and Linux have no `OffscreenCanvas`. So check a WebKit difference in the real app, with `last_error` after a session.
- Custom visualizations need macOS 14 or later: WebGL2 on an `OffscreenCanvas` in a worker arrived with Safari 17. Older systems report `unsupported`.
- `EXT_color_buffer_float` can be missing; the preview's GPU line says. GPGPU should fall back to `THREE.HalfFloatType`, as `examples/smoke-flow-gpgpu.js` does.
- WebKit coarsens `performance.now()`, so preview timings there are less precise.

## Version policy and changelog

- three.js and postprocessing are upgraded together, and only with Glimt's sandbox test suite green. postprocessing 6.39.5 supports three.js below 0.187, so a three.js upgrade waits for a matching postprocessing release.
- Exports are never removed silently. One that stops working moves to the unavailable list with a reason, because saved modules may use it.
- The sandbox API version (`api_version` in `get_visualization_capabilities`) goes up only when the module-facing API changes, not for library patches.

| API | Glimt libraries | Changes for modules |
|---|---|---|
| 2 | three 0.186.1, three/addons 0.186.1, postprocessing 6.39.5 | Added `three/addons` and `postprocessing`, guarded namespaces, `get_visualization_capabilities`, and preview timing that includes the GPU |
| 1 | three 0.186.1 | `requires = ["three"]` only |
