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

export default function create({ canvas }) {
  const ctx = canvas.getContext("2d")
  let level = 0
  let lastTime = 0

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

      const halo = ctx.createRadialGradient(cx, cy, radius * 0.6, cx, cy, radius * 1.3)
      halo.addColorStop(0, `rgba(96, 85, 247, ${0.2 + 0.25 * level})`)
      halo.addColorStop(1, "rgba(96, 85, 247, 0)")
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(cx, cy, radius * 1.3, 0, Math.PI * 2)
      ctx.fill()

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

    // Everything is drawn from canvas.width/height each frame, so nothing to do.
    resize() {},

    dispose() {},
  }
}
