// Uses the session: a ring that fills through each breath cycle, and below it
// the playlist's sections as a segmented bar with the current section's name.
// Shows how to read `phaseProgress`, `round`, `sequenceIndex` and `session`.

const ease = (t) => 0.5 - Math.cos(Math.PI * t) / 2

/** Below this CSS width (e.g. the round micro reminder) there's no room for text. */
const MIN_TEXT_WIDTH = 260

export default function create({ canvas, size }) {
  const ctx = canvas.getContext("2d")
  let dpr = size.dpr
  let cssWidth = size.width

  return {
    render(sequences, state, canvas, session) {
      const pattern = sequences[state.sequenceIndex]?.sequence[state.seq]
      const phase = pattern?.phases[state.phase]
      if (!phase) return

      const { width, height } = canvas
      const unit = Math.min(width, height)
      const cx = width / 2
      const cy = height * 0.42
      ctx.clearRect(0, 0, width, height)

      // Ring: one revolution per breath cycle (round). phaseProgress is 0 → 1 through the round.
      const radius = unit * 0.26
      const lineWidth = Math.max(2, unit * 0.018)
      ctx.lineCap = "round"
      ctx.lineWidth = lineWidth
      ctx.strokeStyle = "rgba(96, 85, 247, 0.18)"
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.stroke()

      const start = -Math.PI / 2
      ctx.strokeStyle = "#6055F7"
      ctx.beginPath()
      ctx.arc(cx, cy, radius, start, start + Math.PI * 2 * state.phaseProgress)
      ctx.stroke()

      // A dot that breathes with the phase, riding the ring's leading edge.
      const angle = start + Math.PI * 2 * state.phaseProgress
      const breathing = phase.type === "inhale" ? ease(state.progress)
        : phase.type === "exhale" ? 1 - ease(state.progress)
        : phase.type === "hold-in" ? 1 : 0
      ctx.fillStyle = "#4F46CE"
      ctx.beginPath()
      ctx.arc(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, lineWidth * (1 + breathing), 0, Math.PI * 2)
      ctx.fill()

      // Sections bar: one segment per sequence, filled by progress through it.
      if (sequences.length > 1) {
        const barWidth = unit * 0.7
        const gap = unit * 0.015
        const segment = (barWidth - gap * (sequences.length - 1)) / sequences.length
        const barY = height * 0.8
        const rounds = pattern.rounds || 1
        const sectionProgress = Math.min(1, (state.round - 1 + state.phaseProgress) / rounds)

        sequences.forEach((_, i) => {
          const x = cx - barWidth / 2 + i * (segment + gap)
          const filled = i < state.sequenceIndex ? 1 : i === state.sequenceIndex ? sectionProgress : 0
          ctx.fillStyle = "rgba(96, 85, 247, 0.18)"
          ctx.fillRect(x, barY, segment, lineWidth)
          ctx.fillStyle = "#6055F7"
          ctx.fillRect(x, barY, segment * filled, lineWidth)
        })
      }

      // Text only where there's room. Labels are null for unnamed patterns and in previews.
      const label = session.sections[state.sequenceIndex]?.label
      if (cssWidth >= MIN_TEXT_WIDTH && (label || session.playlist)) {
        ctx.textAlign = "center"
        ctx.fillStyle = "rgba(120, 112, 200, 0.85)"
        ctx.font = `500 ${Math.round(13 * dpr)}px system-ui, sans-serif`
        if (label) ctx.fillText(label, cx, height * 0.8 - 12 * dpr)
        if (session.playlist) {
          ctx.font = `400 ${Math.round(11 * dpr)}px system-ui, sans-serif`
          ctx.fillText(session.playlist.name, cx, height * 0.8 + 24 * dpr)
        }
      }
    },

    resize(next) {
      dpr = next.dpr
      cssWidth = next.width
    },

    dispose() {},
  }
}
