# The Glimt palette

These are the colours of Glimt's built-in 3D orb as they appear on screen. Use them for every visualization unless the user names colours, or asks for a theme that brings its own (ocean, sunset, forest). Even then, a violet outline or halo from this palette can tie the piece back to Glimt if it fits.

## The colours

From the top of the orb to the bottom:

| Role | Breathing | Hold | Where it shows on the orb |
|---|---|---|---|
| `flush` | `#AE5D87` | `#A65183` | A thin, warm dusty-rose crest along the top |
| `orchid` | `#9A5AA3` | `#8E4B9E` | The blend from the flush into the body, upper third |
| `body` | `#6451D2` | `#6D43BB` | The lit centre and upper left. The dominant colour |
| `shade` | `#5C4AB4` | `#653D97` | The side turned away from the light: right, middle to low |
| `indigo` | `#533E9D` | `#5D358D` | The lower third |
| `deep` | `#482A77` | `#4D2368` | The bottom |
| `rim` | `#5349D2` | `#5137A6` | A band just inside the silhouette |
| `outline` | `#4C3BB4` | `#4B339D` | A thin line on the silhouette, about 1.4 CSS px |
| `glow` | `#6055F7` | `#6055F7` | The halo, at low alpha: a faint lavender near the shape that is gone by about 1.7× its radius |

Together they make a vertical gradient from rose through orchid and violet to indigo and plum. The light comes from the upper left, and a crisp periwinkle edge and a soft violet halo surround the shape. While air moves the orb is a brighter, bluer violet. In the holds it turns a deeper, redder purple, cross-fading over about 0.6 s.

## Using it

- **Proportions.** `body`, `shade` and `indigo` cover most of the area. `flush` and `orchid` stay a thin band at the top or on highlights, never a large fill. Keep the `outline` thin and the `glow` faint.
- **Beyond an orb.** Map the gradient onto the shape's own "up", or onto intensity: brightest or nearest parts get `flush` and `orchid`, the middle gets `body`, and far or low parts get `indigo` and `deep`. Edges get `rim` or `outline`. Halos, bloom and particle glow get `glow`. For a lotus, that means `body` petals with `orchid`/`flush` tips, an `outline` edge and a `glow` halo. For particles, use `body` and `shade` for the mass, and a few `orchid` ones where they gather.
- **Follow the breath.** Cross-fade from the breathing column to the hold column during `hold-in` and `hold-out`, and back when air moves. Use the glide from SKILL.md, "Ease, and never snap" (only for colour; the radius follows the sine ease directly) with a time constant of about 0.6 s. It's optional, but it's what the orb does.
- **Aim the final pixel at these colours.** They are on-screen colours, not lighting inputs. If you shade with them, e.g. multiply by a diffuse term, the result comes out darker and muddier than the orb. Paint the gradient with them directly, and keep any added lighting gentle.

## In code

```js
// The Glimt palette: on-screen colours of the built-in 3D orb (references/palette.md).
const GLIMT_PALETTE = {
  breathing: {
    flush: "#AE5D87", orchid: "#9A5AA3", body: "#6451D2", shade: "#5C4AB4", indigo: "#533E9D",
    deep: "#482A77", rim: "#5349D2", outline: "#4C3BB4", glow: "#6055F7",
  },
  hold: {
    flush: "#A65183", orchid: "#8E4B9E", body: "#6D43BB", shade: "#653D97", indigo: "#5D358D",
    deep: "#4D2368", rim: "#5137A6", outline: "#4B339D", glow: "#6055F7",
  },
}
```

- **three.js:** `new THREE.Color(GLIMT_PALETTE.breathing.body)` stores linear RGB, so pass it as a uniform and use it in shader maths directly. To blend between stops or between the two palettes in a shader, use `oklabMix` from the cookbook.
- **2D canvas:** the hex strings are sRGB. Canvas gradients between neighbouring stops (e.g. `body` → `indigo`) are fine as they are. To cross-fade the two palettes in JavaScript, convert to linear RGB, mix there and convert back, not on the raw sRGB values.

## The counter

Glimt draws the phase countdown (`show_counter`) in violet `#897aff` while breathing and in rose `#e687d8` at 60% opacity during holds. It reads well on this palette, so a visualization in these colours never needs a `counter_color`. Set one only for a palette of its own that this pair doesn't suit (SKILL.md, Creating, step 8).

## Where these come from

The colours were sampled from renders of the default orb at its default settings. The orb shader takes different inputs (`Orb3DPalette` in glimt-app's `packages/ui/src/components/animations/Orb3DVisualization.ts/types.ts`) and mixes and multiplies them: its orange top light shows up as the dusty-rose `flush`, and its gold shadow tint only darkens the `shade` side. Don't use those inputs as flat colours. When the orb's palette changes, sample a new render and update this file.
