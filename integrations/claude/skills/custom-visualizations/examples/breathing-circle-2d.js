// A soft, glowing circle that fills with the breath: it grows on the inhale,
// rests on the holds and lets go on the exhale. Plain 2D canvas, no libraries.

/** Ease in and out, 0 → 1. */
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

const HALO_ALPHA = 0.45 // fully in; the halo fades to 0.2 when fully out

/**
 * The halo at its largest, drawn once per canvas size. A canvas gradient this
 * faint is quantised to 8 bits without dithering and shows rings on dark
 * backgrounds, so the alpha is computed per pixel with a few levels of
 * triangular noise instead. This is the 2D version of the shader cookbook's
 * dithering. The noise comes from a fixed-seed generator, never Math.random,
 * so previews repeat.
 */
function haloSprite(outer) {
  const size = Math.ceil(outer * 2)
  const image = new ImageData(size, size)
  const pixels = new Uint32Array(image.data.buffer) // one little-endian ABGR word per pixel
  const rgb = (247 << 16) | (85 << 8) | 96
  const half = size / 2
  const scale = 1.3 / outer // to units of the circle's radius: the halo spans 0.6 → 1.3
  let seed = 0x9e3779b9
  const random = () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) / 4294967296
  }
  for (let y = 0; y < size; y++) {
    const dy = y + 0.5 - half
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - half
      const d = Math.sqrt(dx * dx + dy * dy) * scale
      if (d >= 1.3) continue
      const t = d <= 0.6 ? 0 : (d - 0.6) / 0.7
      const alpha = HALO_ALPHA * 255 * (1 - t * t * (3 - 2 * t))
      const noise = (random() + random() - 1) * 4 // triangular, ±4 levels
      const a = Math.min(Math.max(Math.round(alpha + noise), 0), 255)
      pixels[y * size + x] = ((a << 24) | rgb) >>> 0
    }
  }
  const sprite = new OffscreenCanvas(size, size)
  sprite.getContext("2d").putImageData(image, 0, 0)
  return sprite
}

export default function create({ canvas }) {
  const ctx = canvas.getContext("2d")
  let level = 0
  let lastTime = 0
  let halo = null
  let haloFor = 0 // the canvas side the halo was drawn for

  return {
    render(sequences, state) {
      const phase = sequences[state.sequenceIndex]?.sequence[state.seq]?.phases[state.phase]
      if (!phase) return

      // Glide towards the target instead of jumping, so phase changes never snap.
      // Frame-rate independent; 12 ≈ settles in a quarter of a second.
      const dt = Math.min(Math.max(state.time - lastTime, 0), 0.1) // never negative: that would blow the glide up to NaN
      lastTime = state.time
      level += (breathLevel(phase, state.progress) - level) * (1 - Math.exp(-12 * dt))

      // canvas.width/height are device pixels and already match the current size.
      const { width, height } = canvas
      const cx = width / 2
      const cy = height / 2
      const radius = Math.min(width, height) * 0.32 * (0.45 + 0.55 * level)

      ctx.clearRect(0, 0, width, height) // keep the background transparent

      const side = Math.min(width, height)
      if (side !== haloFor) {
        halo = haloSprite(side * 0.32 * 1.3)
        haloFor = side
      }
      // Scaled down to the current radius. Nearest-neighbour keeps the dither;
      // smoothing would average it away and bring the rings back.
      ctx.globalAlpha = (0.2 + 0.25 * level) / HALO_ALPHA
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(halo, cx - radius * 1.3, cy - radius * 1.3, radius * 2.6, radius * 2.6)
      ctx.imageSmoothingEnabled = true
      ctx.globalAlpha = 1

      const body = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.35, radius * 0.1, cx, cy, radius)
      body.addColorStop(0, "#f6f4ff")
      body.addColorStop(1, "#bdb6fb")
      ctx.fillStyle = body
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.fill()

      ctx.lineWidth = Math.max(1, radius * 0.025)
      ctx.strokeStyle = "#4F46CE"
      ctx.stroke()
    },

    // Everything is drawn from canvas.width/height each frame, and the halo is
    // redrawn when the size changes, so nothing to do.
    resize() {},

    dispose() {
      halo = null
    },
  }
}
