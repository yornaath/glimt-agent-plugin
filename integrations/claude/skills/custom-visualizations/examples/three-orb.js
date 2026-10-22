// A milky three.js orb with a thin purple edge. It swells with the breath and
// its surface ripples while air moves, settling during holds.

export const requires = ["three"]

const ease = (t) => 0.5 - Math.cos(Math.PI * t) / 2

function breathLevel(phase, progress) {
  switch (phase.type) {
    case "inhale": return ease(progress)
    case "hold-in": return 1
    case "exhale": return 1 - ease(progress)
    case "hold-out": return 0
  }
}

/** Frame-rate independent glide; `rate` ≈ 1 / seconds to settle. */
const approach = (current, target, dt, rate) => current + (target - current) * (1 - Math.exp(-rate * dt))

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uRipple;
  varying vec3 vNormal;
  varying vec3 vView;

  void main() {
    vec3 p = position;
    float wave = sin(p.x * 3.0 + uTime * 1.3) * sin(p.y * 3.4 + uTime * 1.1) * sin(p.z * 2.9 + uTime * 0.9);
    p += normal * wave * uRipple;

    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uBody;
  uniform vec3 uEdge;
  varying vec3 vNormal;
  varying vec3 vView;

  void main() {
    vec3 normal = normalize(vNormal);
    float facing = clamp(dot(normal, normalize(vView)), 0.0, 1.0);
    float edge = smoothstep(0.35, 0.0, facing);   // 1 at the silhouette
    float light = 0.92 + 0.08 * normal.y;          // soft light from above
    vec3 body = mix(uBody * light, uEdge, 0.12 * (1.0 - normal.y)); // faint purple bounce below
    gl_FragColor = vec4(mix(body, uEdge, edge), 1.0);
  }
`

export default function create({ canvas, size, THREE }) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" })
  renderer.setClearColor(0x000000, 0) // transparent background
  renderer.setPixelRatio(size.dpr)
  renderer.setSize(size.width, size.height, false) // false: an OffscreenCanvas has no CSS size to set

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(35, size.width / size.height, 0.1, 20)
  camera.position.z = 6

  const uniforms = {
    uTime: { value: 0 },
    uRipple: { value: 0 },
    uBody: { value: new THREE.Color("#f1efff") },
    uEdge: { value: new THREE.Color("#6055F7") },
  }
  const geometry = new THREE.IcosahedronGeometry(1, 24)
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader })
  const orb = new THREE.Mesh(geometry, material)
  scene.add(orb)

  let level = 0
  let ripple = 0
  let lastTime = 0

  return {
    render(sequences, state) {
      const phase = sequences[state.sequenceIndex]?.sequence[state.seq]?.phases[state.phase]
      if (!phase) return

      const dt = Math.min(state.time - lastTime, 0.1)
      lastTime = state.time
      const moving = phase.type === "inhale" || phase.type === "exhale"
      level = approach(level, breathLevel(phase, state.progress), dt, 12)
      ripple = approach(ripple, moving ? 0.07 : 0.015, dt, 3)

      orb.scale.setScalar(0.55 + 0.45 * level)
      orb.rotation.y = state.time * 0.1
      uniforms.uTime.value = state.time
      uniforms.uRipple.value = ripple

      renderer.render(scene, camera)
    },

    resize(next) {
      renderer.setPixelRatio(next.dpr)
      renderer.setSize(next.width, next.height, false)
      camera.aspect = next.width / next.height
      camera.updateProjectionMatrix()
    },

    dispose() {
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    },
  }
}
