# Choosing a technique

Go from what the user describes to a technique, the cookbook snippets it needs (`references/shader-cookbook.md`) and the example to start from (`examples/`). Start from the example, copy snippets verbatim with their credits, and change the look from there.

| The user says | Technique | Snippets | Start from |
|---|---|---|---|
| "simple", "minimal", "small", "a circle" | 2D canvas shapes, soft gradients pre-rendered once per size with dither | (2D: none) | `breathing-circle-2d.js` |
| "words", "counting", "show my session", "progress" | 2D canvas text from `session` and `state` | (2D: none) | `session-text-2d.js` |
| "orb", "sphere", "planet", "bubble" | A three.js mesh with a custom shader | `fresnelSchlick`, `wrapDiffuse` | `three-orb.js` |
| "flower", "lotus", "mandala", "geometric", "star" | 2D distance fields in a full-screen shader, rotated copies | `rot2`, `sdPetal`, `sdVesica`, `sdStar5`, `sdCircle`, `opSmoothUnion`, `aaFill`, `sdfGlow`, `oklabMix` | `sdf-lotus-2d.js` |
| "waves", "ripples", "water", "aurora", "silk", "ink" | A full-screen shader of layered noise and domain warping | `fbm2`, `warp2`, `cosPalette`, `oklabMix`, `ditherRgba` | `sdf-lotus-2d.js` as the shell |
| "clouds", "mist", "fog", "nebula" | Full-screen fbm, at half resolution when full screen | `fbm3`, `smootherstep`, `ditherRgba` | `sdf-lotus-2d.js` as the shell |
| "smoke", "stardust", "galaxy", "particles", "fireflies" | GPGPU particles on curl noise | `curl3`, `hash22`, `pointSize`, `softSprite`, `oklabMix` | `smoke-flow-gpgpu.js` |
| "glow", "sun", "soft light", "halo", "radiant" | A shape plus bloom, transparency kept | `fresnelSchlick`, `ditherRgba` | `glow-orb-postprocessing.js` |
| "glass", "crystal", "ice", "soap bubble" | `MeshPhysicalMaterial` transmission or iridescence with `RoomEnvironment` | the cookbook's Light section | `three-orb.js`; no example yet |
| "lava lamp", "blobs", "merging", "liquid" | Metaballs: `opSmoothUnion` in 2D, or `addons.MarchingCubes` in 3D | `opSmoothUnion`, `aaFill`, `sdfGlow` | `sdf-lotus-2d.js` (2D); no 3D example yet |
| "trails", "afterglow", "comet", "light painting" | A feedback render target that fades the previous frame | `feedbackFade` and the cookbook's ping-pong setup | no example yet |

**Pick one hero technique and build it out properly.** One technique done with care (eased motion, crisp edges, colour mixed in OKLab, no banding, a clean transparent background) looks better than three stacked effects. Stacking is how quality drops and cost climbs. Add a second element only when it supports the first, like the lotus's halo or the orb's glow.

Map the breath to the technique's natural motion:
- **Shapes** grow, open or rise on the inhale.
- **Noise fields** speed up or brighten while air moves and settle in the holds. Change the speed slowly, through the glided level, never by jumping `uTime`.
- **Particles** gather on the inhale and loosen on the exhale.
- **Glow** swells with the breath.
