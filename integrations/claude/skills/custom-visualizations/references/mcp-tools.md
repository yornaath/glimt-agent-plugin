# MCP tools for custom visualizations

All tools are on the `glimt` MCP server, which the Glimt desktop app serves on `http://127.0.0.1:43110/mcp` while it runs with MCP turned on. A failing call returns an error whose text is the reason, e.g.:

- `Invalid entity: name must not be empty`
- `Invalid entity: source is 600000 bytes, the limit is 524288`
- `Entity with id 7 not found`
- `Entity with id 7 is in use` (delete of the selected visualization)

Timestamps are RFC 3339 strings in UTC.

## The objects

```ts
type CustomVisualization = {
  id: number
  name: string
  description: string
  source: string                          // the module source
  revision: number                        // 1 on create, +1 on every update
  last_error: CustomVisualizationError | null
  created_at: string
  updated_at: string
}

type CustomVisualizationSummary = Omit<CustomVisualization, "source" | "created_at">

type CustomVisualizationError = {
  kind: "error" | "timeout" | "unsupported"
  message: string
  stack: string | null
  revision: number                        // always the current revision; older errors are dropped
  at: string
}
```

## `list_custom_visualizations`

Arguments: none. Returns `CustomVisualizationSummary[]`, sorted by name. Read-only.

## `get_custom_visualization`

```json
{ "id": 3 }
```

Returns `CustomVisualization`, including `source` and `last_error`. Read-only. This is how you check whether the current revision failed at runtime.

## `create_custom_visualization`

```json
{
  "visualization": {
    "name": "Ocean waves",
    "description": "Waves roll in as you inhale and wash out as you exhale.",
    "source": "export default function create({ canvas, size }) { … }"
  }
}
```

All three fields are required; use `""` for no description. Limits: `name` 1–100 characters, `description` up to 2000 characters, `source` non-empty and at most 512 KB. Returns the created `CustomVisualization`. Creating doesn't select it; see `update_settings` below.

## `update_custom_visualization`

```json
{ "id": 3, "patch": { "source": "export default function create(ctx) { … }" } }
```

`patch` takes any of `name`, `description` and `source`; fields you leave out keep their value. Every update increments `revision`, clears `last_error`, and makes open Glimt windows reload the visualization right away. Returns the updated `CustomVisualization`.

## `preview_custom_visualization`

Renders a module off screen through one breath cycle and returns what it drew. Nothing is saved, the settings don't change and nothing appears on the user's screen. Read-only.

```json
{ "source": "export default function create({ canvas, size }) { … }" }
```

```json
{
  "id": 3,
  "pattern": { "inhale": 4, "hold_in": 7, "exhale": 8, "hold_out": 0 },
  "width": 220,
  "height": 220,
  "background": "light"
}
```

| Argument | Default | |
|---|---|---|
| `id` or `source` | (one is required) | A saved visualization, or a draft module source (same limits as `create`) |
| `pattern` | `{ "inhale": 4, "hold_in": 4, "exhale": 4, "hold_out": 4 }` | Seconds per phase; 0 skips a phase; 1–60 s in total |
| `width`, `height` | `480` | CSS pixels, 64–1024, rendered at a device pixel ratio of 1 |
| `background` | `"dark"` | `"dark"` or `"light"` (the app's page backgrounds), or `"transparent"` |

It returns MCP content blocks, not JSON:
1. **A summary:**
   - what was previewed, the size, background and pattern
   - the timings and the GPU, in these lines:
     ```
     Rendered 480 frames. render() CPU time: 0.1 ms average, 6.2 ms slowest.
     Whole frame including GPU work, at 480×480: 0.9 ms average, 14.0 ms slowest (the slowest is usually the first, which compiles shaders).
     Estimated at the user's largest full screen canvas (3072×1920 px): about 21.0 ms a frame, if the GPU cost is per pixel. The budget is 16 ms; aim for well under it on a laptop.
     GPU: WebGL2 yes, float render targets (EXT_color_buffer_float) yes, max texture size 16384.
     ```
   - `No errors.`, or `The module FAILED (Error|Timeout|Unsupported): <message>` followed by the stack
   - the folder the PNGs were saved to
2. **For each snapshot:** a label (`Frame 2: end of inhale (fully in)`) followed by the PNG image.

Reading the timings:
- **render() CPU time** is your JavaScript. With WebGL it's usually small, because the GPU does the work later.
- **Whole frame** adds waiting for that GPU work, measured on the user's own GPU. This is the number to keep low: under 4 ms average at 1024×1024 is a good target. For a 2D module, the two are about the same.
- **The full screen estimate** scales the GPU part to the biggest canvas the module gets (from `get_display_info`), assuming it costs per pixel, which is true for full-screen shaders and roughly true for post-processing. Over 16 ms means it will stutter full screen. Render the expensive part into a target capped near 1 MP, put post-processing at half resolution, or simplify. For a 2D module, it's about the CPU time, since only the GPU part is scaled.
- **GPU** says what techniques can rely on. Without float render targets, GPGPU must use `THREE.HalfFloatType`.

Older versions of Glimt only report the first line, as `Rendered N frames: X ms average, Y ms slowest.`, measured on the CPU.

Snapshots are taken at each phase's midpoint, plus the end of the inhale and of the exhale. With all four phases that's 6 frames; phases of 0 s are skipped. When the module fails there are no frames.

How it works:
- **Virtual time.** The module is created fresh, then `render` is called for every frame of the cycle at 30 virtual frames per second, as fast as it can render. `state.time` advances 1/30 s per frame, so a 16 s cycle previews in about a second.
- **The same sandbox** and limits as the real visualization: a hang is caught after 4 s, and the whole preview gives up after 30 s.
- **The session** has one section labelled with the pattern (e.g. `4-7-8`) and no playlist.
- **Saved files.** The PNGs are also saved to `<system temp>/glimt-visualization-preview/`, replaced on every preview, so the user can open them.
- **One preview at a time.** The first one takes a few seconds longer while Glimt opens its hidden preview window.

## `get_visualization_capabilities`

Arguments: none. Read-only. Returns what modules can use in this version of Glimt. **Call it before writing a module.** Older versions of Glimt don't have this tool. There, only `requires = ["three"]` works and previews time the CPU only.

```json
{
  "api_version": 2,
  "libraries": [
    { "name": "three", "context_key": "THREE", "version": "0.186.1", "depends_on": [], "exports": [], "unavailable": [] },
    {
      "name": "three/addons", "context_key": "addons", "version": "0.186.1", "depends_on": ["three"],
      "exports": ["BokehPass", "BufferGeometryUtils", "ClearPass", "CopyShader", "…"],
      "unavailable": [{ "name": "AfterimagePass", "reason": "It reads window.innerWidth, which a worker doesn't have. …" }, "…"]
    },
    {
      "name": "postprocessing", "context_key": "postprocessing", "version": "6.39.5", "depends_on": ["three"],
      "exports": ["AdaptiveLuminanceMaterial", "AdaptiveLuminancePass", "BlendFunction", "BloomEffect", "…"],
      "unavailable": [{ "name": "SMAAEffect", "reason": "It decodes its lookup textures with Image, …" }, "…"]
    }
  ]
}
```

- `name` goes in `requires`; the library arrives as `ctx[context_key]`.
- `exports` lists every name of a guarded library; it's empty for `three`, whose API is three.js's own.
- `unavailable` names exports left out on purpose. Reading one throws its `reason`.
- `api_version` goes up when the module API changes. `references/libraries.md` has the changelog.

## `delete_custom_visualization`

```json
{ "id": 3 }
```

Fails with `… is in use` while the visualization is selected in the settings. Select another one first.

## Related tools

### `get_settings` / `update_settings`

`update_settings` replaces the whole settings object, so always `get_settings` first, change only `visuals.visualization`, and send everything back:

```json
{
  "settings": {
    "…": "every other field exactly as get_settings returned it",
    "visuals": {
      "fullscreen": true,
      "visualization": { "CustomVisualization": { "id": 3 } }
    }
  }
}
```

The `visualization` variants are:

| Value | Shows |
|---|---|
| `{ "CustomVisualization": { "id": 3 } }` | Custom visualization 3 |
| `{ "Orb3DVisualization": {} }` | The built-in 3D orb (the default) |
| `{ "FlatOrbVisualization": { "orb_animation_mode": "Uneven", "orb_unevenness": 20 } }` | The built-in flat orb; `orb_animation_mode` is `"Default"` or `"Uneven"`, `orb_unevenness` is 0–100 |

`visuals.fullscreen` makes the breathing prompt fill the screen, which is good for checking how a visualization scales. Ask the user before changing it.

### `get_display_info`

Read only, no arguments. Returns the user's monitors and the sizes a module gets on each, so you never need to ask for resolution or scaling. It applies the sandbox's own clamps (`dpr` 0.5–2, 4096 px per side).

```json
{
  "fullscreen_setting": false,
  "monitors": [{
    "name": "\\\\.\\DISPLAY1",
    "is_prompt_monitor": true,
    "physical_width": 3840, "physical_height": 2400,
    "scale_factor": 2.5,
    "logical_width": 1536, "logical_height": 960,
    "sandbox_dpr": 2,
    "upscale": 1.25,
    "surfaces": [
      { "surface": "prompt", "css_width": 480, "css_height": 480, "canvas_width": 960, "canvas_height": 960 },
      { "surface": "prompt_windowed", "css_width": 480, "css_height": 480, "canvas_width": 960, "canvas_height": 960 },
      { "surface": "prompt_fullscreen", "css_width": 1536, "css_height": 960, "canvas_width": 3072, "canvas_height": 1920 },
      { "surface": "micro", "css_width": 220, "css_height": 220, "canvas_width": 440, "canvas_height": 440 }
    ]
  }]
}
```

- `css_width/height` is `size.width/height` in the module, and `canvas_width/height` is `canvas.width/height`. `prompt` is the prompt as the user has it configured now.
- `upscale` is how much the OS stretches the canvas on screen. 1 is pixel sharp. Above 1 (scaling over 200 %), thin lines and small text look soft, so make them a little bolder.
- Pass a surface's `css_width`/`css_height` to `preview_custom_visualization` to check it at the user's real size. Previews always render at `dpr` 1.

### `show_main_breath_reminder`

Opens the breathing prompt with the user's main preset or playlist, which is the best way to preview.

```json
{ "reminder_mode": "Immediate" }
```

```json
{ "reminder_mode": { "Offer": { "text": "Want to try your new visualization?" } } }
```

`Immediate` starts right away. `Offer` first asks the user in the prompt whether they want the session (`text` is optional), which is better when they might be in the middle of something. Leaving out `reminder_mode` behaves like `Immediate`. The call fails while another reminder is already on screen; ask the user to finish or close it.

### `show_micro_breath_reminder`

Same `reminder_mode` argument. It shows the ~220 px round micro reminder, which renders the selected visualization at small size.

### `show_custom_breath_session`

Starts a session with a given preset, playlist or ad-hoc pattern. Useful for previewing a visualization against a playlist, so the session has sections and names. See its own tool description for the payload.
