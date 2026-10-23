# Module API

A custom visualization is the source of one ES module. Glimt runs it in a Web Worker inside a sandboxed iframe and draws it where the built-in breathing orb would be.

This document mirrors `packages/core/src/visualization/CustomVisualizationApi.ts` and `apps/app/src-tauri/sandbox/runner.html` in the glimt-app repo. When they disagree, the code wins.

## Exports

```ts
/** Optional. Libraries to inject into create(). Only "three" exists. */
export const requires: Array<"three">

/** Required. Called once per mount; may return a Promise. */
export default function create(ctx: VisualizationContext): Renderer | Promise<Renderer>
```

A module without a default-exported function, or whose `create` doesn't return an object with a `render` function, fails with a descriptive error. `resize` and `dispose` are optional in practice, but always include them.

## `create(ctx)`

```ts
type VisualizationContext = {
  canvas: OffscreenCanvas
  size: VisualizationSize
  /** The `three` module namespace (`import * as THREE from "three"`); present only when `requires` includes "three". */
  THREE?: typeof import("three")
}

type VisualizationSize = {
  width: number   // CSS pixels
  height: number  // CSS pixels
  dpr: number     // device pixel ratio, clamped to 0.5–2
}
```

- **`canvas.width` and `canvas.height` are device pixels.** They are already set to `round(size.width * dpr)` × `round(size.height * dpr)`, capped at 4096 per side, so 2D drawing can use `canvas.width/height` directly.
- **The canvas is an `OffscreenCanvas`.** It has `getContext("2d" | "webgl" | "webgl2" | "bitmaprenderer")`, `width` and `height`. It has no CSS size, `clientWidth` or DOM events. `canvas.style` is an empty stub object, so three.js's `setSize` doesn't crash; still pass `false` as the third argument.
- **three.js:** `new THREE.WebGLRenderer({ canvas, alpha: true })`, then `renderer.setPixelRatio(size.dpr)` and `renderer.setSize(size.width, size.height, false)`. The three.js version is the one Glimt bundles; addons (OrbitControls, postprocessing, loaders) aren't included.
- **Async is fine.** `create` may be `async`, e.g. to build textures first. It must settle within 10 seconds, counting from when the module loaded, or it is killed.

## `render(sequences, state, canvas, session)`

Called on every animation frame of the worker (usually 60 Hz, throttled when the window is hidden). Rendering only starts once the app has sent both the sequences and the state. In a preview, it is instead called back to back in virtual time (see Lifecycle).

**Take every animation from `state` and `state.time`.** Never use `performance.now()`, `Date.now()`, timers or your own `requestAnimationFrame` for motion: previews run faster than real time, and wall-clock motion would look frozen in the snapshots.

```ts
type BreathingSequence = { sequence: BreathingPattern[] }

type BreathingPattern = {
  kind: "countdown" | "breathing"
  phases: Phase[]
  rounds: number        // how many times the phases repeat
}

type Phase = {
  type: "inhale" | "hold-in" | "exhale" | "hold-out"
  duration: number      // seconds
  instructions?: string | string[]
}

type VisualizationState = {
  sequenceIndex: number // index into `sequences`: which section of the session is playing
  seq: number           // index into sequences[sequenceIndex].sequence: which pattern
  phase: number         // index into that pattern's phases
  progress: number      // 0 → 1, linear, through the current phase
  round: number         // 1-based round of the current pattern
  phaseProgress: number // 0 → 1 through the current round (all phases of one cycle)
  time: number          // seconds since create() finished; use it for ambient motion and dt
}
```

The current phase, and the one after it:

```js
const pattern = sequences[state.sequenceIndex]?.sequence[state.seq]
const phase = pattern?.phases[state.phase]
if (!phase) return
const next = pattern.phases[(state.phase + 1) % pattern.phases.length]
const secondsLeft = phase.duration * (1 - state.progress)
const sectionProgress = (state.round - 1 + state.phaseProgress) / pattern.rounds // 0 → 1 through this section
```

Notes:
- **Holds of 0 seconds are left out.** A 4-0-4-0 pattern has two phases, `inhale` and `exhale`, so always look phases up by index and type. Never assume four phases.
- **Countdown patterns use the app's own countdown.** A section can start with a `kind: "countdown"` pattern (a single `exhale`-typed phase); while it plays, the app shows its own countdown instead of your visualization. That is also why `state.seq` can be 1 when breathing starts. Use the lookup above and it works either way.
- **`progress` is linear.** Apply your own easing.
- **`state` is a fresh object every frame.** It's safe to keep a reference to the previous one.

### `session`

Names of what's playing, for visualizations that want to show them:

```ts
type VisualizationSession = {
  playlist: { name: string; description: string } | null  // null unless a playlist is playing
  sections: Array<{
    kind: "countdown" | "breathing"
    label: string | null        // preset name, or e.g. "4-7-8" for a bare pattern; null when unknown
    description: string | null
    rounds: number
  }>                            // one entry per element of `sequences`, same order
}
```

The current section is `session.sections[state.sequenceIndex]`. Labels are `null` in the settings preview and the micro reminder, so always handle `null`.

## `resize(size)`

Called after the visualization's box changes size, e.g. when the window goes full screen. The canvas backing store has already been resized when it runs. It isn't called on start; use `ctx.size` there. Update projection matrices, cached gradients and font sizes here.

## `dispose()`

Called when the visualization is removed, but best-effort: the whole sandbox is torn down right after, so GPU memory is freed either way. Disposing three.js geometries, materials and the renderer is still good practice.

## Lifecycle

- **Where it's shown:**
  - The breathing prompt window (about 480×480, or full screen).
  - The micro reminder (about 220 px, clipped to a circle).
  - The Visuals settings preview. It loops the user's main preset (box breathing for playlists) three rounds at a time, and the session is anonymous.
- **`create` can run several times in one session.** The visualization is recreated after a countdown section and when its source is updated, and it can be recreated when a window shows it again. `state.time` restarts at 0 each time. Don't rely on state surviving between mounts, and there is no storage to persist it.
- **Updates hot-reload.** When the agent updates the source, every open window reloads the new revision immediately.
- **Previews** (`preview_custom_visualization`):
  - `create` runs in a hidden window at the requested size with `dpr` 1.
  - `render` is called once per 1/30 s of virtual time through one breath cycle, as fast as the module can go, and a few frames are snapshotted. `resize` isn't called.
  - The session is a single section labelled with the pattern, with no playlist.
  - A module that animates from `state.time` looks the same in a preview as live, including any smoothing based on `dt`.

## The sandbox

The module runs in a dedicated worker with an opaque origin and this Content Security Policy: no network, scripts only from the sandbox itself. In practice:

| Available | Not available |
|---|---|
| `OffscreenCanvas` 2D, WebGL, WebGL2 | `window`, `document`, DOM, CSS, events, input |
| `ctx.THREE` (when required) | `import` / `import()` of URLs or packages, `importScripts` |
| `Math`, typed arrays, `ImageData`, `createImageBitmap` from generated data | `fetch`, XHR, WebSocket, loading images or fonts from URLs |
| `performance.now()`, `setTimeout`/`setInterval`, `requestAnimationFrame` | `localStorage`, IndexedDB, cookies |
| System fonts for canvas text (`system-ui, sans-serif`) | Web fonts |
| `crypto.getRandomValues` | Anything of the Glimt app or the user's machine |

Make textures procedurally: draw to another `OffscreenCanvas`, fill an `ImageData`, or use `THREE.DataTexture` / `THREE.CanvasTexture`.

## Failure handling

The module is stopped at the first failure, the user sees the built-in 3D orb, and the error is saved as the visualization's `last_error` for the current revision:

| Kind | When |
|---|---|
| `error` | The module fails to load (syntax error, any `import`), `create` throws or rejects, `render`/`resize` throws, an unhandled promise rejection, a bad export, or more than 1000 messages per second to the host |
| `timeout` | No response for 10 s while loading/creating, or 4 s once running (e.g. an endless loop), or the sandbox itself goes quiet for 8 s |
| `unsupported` | The system webview lacks OffscreenCanvas, module workers, or the sandbox didn't load within 8 s |

Messages are capped at 4000 characters and stacks at 16000. A new revision clears the error and gets a fresh start.

### Failures that are *not* caught

Some failures throw nothing, so nothing above sees them: the user gets a blank area, `last_error` stays `null`, and a preview says `No errors.` with blank frames. Make them throw:

- **Shader compile/link errors.** three.js only logs these. Verified in the sandbox: with this hook, the preview reports the GLSL error and line.
  ```js
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    throw new Error("Shader failed: " + (gl.getShaderInfoLog(fs) || gl.getShaderInfoLog(vs) || gl.getProgramInfoLog(program) || "").trim())
  }
  ```
- **Lost WebGL context.** The GPU reset, or there were too many contexts. three.js stops drawing and waits for a restore. Throw if it doesn't come back:
  ```js
  let lostAt = null
  canvas.addEventListener("webglcontextlost", () => { lostAt = lastTime })
  canvas.addEventListener("webglcontextrestored", () => { lostAt = null })
  // in render(), after updating lastTime:
  if (lostAt !== null) { if (state.time - lostAt > 3) throw new Error("WebGL context lost"); return }
  ```
  In `dispose`, call `renderer.forceContextLoss()` after `renderer.dispose()` so remounts don't pile up contexts.
- **`NaN` in animation state.** It draws nothing, forever. Clamp `dt` to `[0, 0.1]` and keep eased values finite.
