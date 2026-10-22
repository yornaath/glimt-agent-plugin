---
name: custom-visualizations
description: Create, edit, debug, list or delete custom breathing visualizations for the Glimt desktop app. Glimt shows an animation while the user breathes; a custom visualization replaces it with a JavaScript module (2D canvas or three.js) that the agent writes and installs through the glimt MCP server. Use when the user wants their own breathing animation, wants to change how the breathing orb or prompt looks ("make it look like ocean waves", "a lotus that opens as I inhale"), asks why their visualization isn't showing or broke, or wants to manage the ones they have.
---

# Glimt custom visualizations

Glimt guides the user through breath work and shows an animation that follows the breath. A **custom visualization** replaces the built-in orb with an ES module you write. You install it through the `glimt` MCP server; the app runs it in a locked-down sandbox and falls back to the built-in orb if anything goes wrong.

Read these before writing a module:
- `references/module-api.md`: the full module API, lifecycle and sandbox limits.
- `references/mcp-tools.md`: exact payloads for every tool used below.
- `examples/`: working modules to start from. They are tested in the real sandbox.
  - `breathing-circle-2d.js`: the smallest complete 2D module.
  - `session-text-2d.js`: reads the playlist and section names, round progress and section progress.
  - `three-orb.js`: three.js with a custom shader.

## Workflow

1. **Check the connection.** The `glimt` MCP tools must be available. If they aren't, ask the user to start Glimt and turn on MCP in its settings, then reconnect with `/mcp`.
2. **Understand the idea** and pick the closest example as a base. Ask what the user wants it to feel like if that isn't clear. Calm and slow is the default.
3. **Write the module.** Save it to a local file the user can keep, e.g. `glimt-visualizations/<name>.js`. If Node is available, run `node --check <file>` to catch syntax errors before installing.
4. **Install it** with `create_custom_visualization` `{ "visualization": { "name", "description", "source" } }` and note the returned `id`.
5. **Select it.** Call `get_settings`, set `visuals.visualization` to `{ "CustomVisualization": { "id": <id> } }`, and pass the whole settings object back to `update_settings`. It replaces all settings, so never send a partial object.
6. **Preview it.** Call `show_main_breath_reminder` with `{ "reminder_mode": "Immediate" }`, or `{ "reminder_mode": { "Offer": { "text": "Want to try your new visualization?" } } }` if the user might be busy. The Visuals page in Glimt's settings also previews it live.
7. **Check for runtime errors.** About 10 seconds after it's on screen, call `get_custom_visualization` `{ "id": <id> }` and read `last_error`. Errors are only recorded while the visualization is rendering, so `null` before a preview proves nothing.
8. **Iterate.** Use `update_custom_visualization` `{ "id": <id>, "patch": { "source": "…" } }`. Open windows reload immediately, the `revision` goes up and `last_error` is cleared. Ask the user how it looks: you can't see the screen.

## The module at a glance

```js
export const requires = ["three"] // optional; omit for plain 2D/WebGL

export default function create({ canvas, size, THREE }) { // may be async
  // canvas: OffscreenCanvas, already sized to size.width*dpr × size.height*dpr
  return {
    render(sequences, state, canvas, session) {
      const phase = sequences[state.sequenceIndex]?.sequence[state.seq]?.phases[state.phase]
      if (!phase) return
      // phase.type: "inhale" | "hold-in" | "exhale" | "hold-out", phase.duration in seconds
      // state.progress: 0 → 1 through the phase; state.time: seconds since create
    },
    resize(size) {},  // after the canvas was resized; size = { width, height, dpr }
    dispose() {},
  }
}
```

`render` runs every animation frame. Derive everything from `state` and `state.time`; don't keep your own clock. The details, including `round`, `phaseProgress` and `session`, are in `references/module-api.md`.

## Hard rules (the sandbox enforces these)

- **No imports, no network.** `import … from "…"`, `fetch`, WebSocket and XHR all fail. three.js is the only library, and it comes in through `export const requires = ["three"]` and `ctx.THREE`. Inline any other helper code you need.
- **No DOM.** The module runs in a Web Worker: there's no `window`, `document`, CSS, `Image` from URLs or DOM events. Draw on the `OffscreenCanvas` with `getContext("2d")`, `getContext("webgl2")` or `new THREE.WebGLRenderer({ canvas })`.
- **No input.** The visualization never receives clicks or keys.
- **Keep the background transparent.** Clear to transparent (`clearRect`, or `setClearColor(0x000000, 0)`). The app's own background and blur show through.
- **Don't draw the app's UI.** Glimt already shows the phase instruction ("Inhale"), the round counter and the Snooze/Skip buttons over the bottom of the area. Leave the lower fifth calm. Section or playlist names are fine.
- **Stay responsive.** If the module goes quiet for more than 10 s while loading, or 4 s after it starts, it is killed and the user sees the built-in orb. Avoid heavy synchronous work and unbounded loops.
- **Limits.** The source can be at most 512 KB, the name at most 100 characters and the description at most 2000. A module that posts messages in a tight loop is killed.

## Designing a good one

- **Follow the breath.** It is a breathing guide first and art second. The user should be able to breathe along without reading anything: inhale grows, rises or brightens; the holds rest, still or barely moving; exhale releases. Use the same mapping for every phase type, because users breathe many patterns.
- **Ease, and never snap.** Ease within a phase (`0.5 - Math.cos(Math.PI * t) / 2`). Glide across phase boundaries with a frame-rate-independent approach: `v += (target - v) * (1 - Math.exp(-rate * dt))`, where `dt` comes from `state.time`. All the examples do this.
- **Calm.** No flashing, strobing or fast flicker: some users are photosensitive, and the point is to relax. Slow ambient motion (drift, shimmer) is fine at well under 1 Hz.
- **Every size.** The same module runs in a 480 px prompt window, full screen on large monitors, a ~220 px round micro reminder and a small settings preview. Scale everything from `Math.min(canvas.width, canvas.height)`. Skip fine detail and text below about 260 CSS px. Multiply line widths and font sizes by `size.dpr`.
- **The Glimt look**, unless the user wants something else: a soft, milky body with a thin purple edge and a gentle halo. Palette: `#6055F7` (brand purple), `#4F46CE` (edge), `#4613C7` (deep), with warm accents `#ED6510` and `#E7C630` used sparingly.
- **Light on the GPU.** It may run for long sessions on laptops. Prefer `powerPreference: "low-power"`, modest geometry and the given `dpr`, which is already capped at 2.

## When something goes wrong

`get_custom_visualization` returns `last_error` as `{ kind, message, stack, revision, at }`.

| `kind` | Typical message | Fix |
|---|---|---|
| `error` | `Failed to load the visualization module: … imports are unavailable` | Remove `import` statements. Use `requires` for three.js and inline everything else. A syntax error also lands here; run `node --check`. |
| `error` | `The module must export default a function create(ctx)…` / `create(ctx) must return an object with a render(…) function` | Export the factory as the default export and return `{ render, resize, dispose }`. |
| `error` | `TypeError: …` / `ReferenceError: …` with a stack | A bug in `create`, `render` or `resize`. Check the stack, and that you guard against a missing `phase`. Common causes: using `document` or `window`, or `canvas.style`/`clientWidth` (use `size` instead). |
| `error` | `Unknown library "x" in requires` | Only `"three"` is available. |
| `error` | `The visualization posted too many messages…` | Don't call `postMessage`. |
| `timeout` | `…did not respond within 10 seconds of loading…` / `…stopped responding for more than 4 seconds…` | An endless loop, or far too much work at load or per frame. Reduce geometry and resolution, and precompute less. |
| `unsupported` | `…OffscreenCanvas is unavailable` / `…can't start the visualization worker` / `The visualization sandbox did not load.` | The user's system webview can't run custom visualizations (e.g. macOS 13 or older). Tell the user; there's no workaround in the module. |

The visualization is still selected after an error; the app shows the orb until a fixed revision loads. If `last_error` stays `null` but the user sees the orb, check that the settings point at the right `id`. Countdown sections always show the app's own countdown.

## Managing visualizations

- `list_custom_visualizations` lists them all without their source. Use `get_custom_visualization` to read one before editing it.
- `delete_custom_visualization` refuses the one selected in settings. Switch first: `get_settings`, set `visuals.visualization` to `{ "Orb3DVisualization": {} }`, call `update_settings`, then delete.
- To go back to the built-in look, set `{ "Orb3DVisualization": {} }` (3D orb) or `{ "FlatOrbVisualization": { "orb_animation_mode": "Uneven", "orb_unevenness": 20 } }` (flat orb).
