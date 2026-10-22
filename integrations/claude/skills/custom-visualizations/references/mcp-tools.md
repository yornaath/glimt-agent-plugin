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
