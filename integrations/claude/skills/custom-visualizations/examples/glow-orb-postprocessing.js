// The milky orb of three-orb.js, glowing: soft bloom that swells as you
// breathe in and fades as you breathe out. Same geometry, shader and breath
// mapping as three-orb.js, so the two compare directly. The reference for
// pmndrs postprocessing: an EffectComposer with one EffectPass for bloom and
// AgX tone mapping, keeping the background transparent.
//
// Cost: the orb into a half float buffer, a mipmap blur bloom at half
// resolution and one full-screen effect pass. Measured in Glimt's test
// harness, which renders on the CPU (SwiftShader): 10 ms a frame at 480×480
// and 39 ms at 1024×1024, including GPU work. A real GPU is many times faster.

export const requires = ["three", "postprocessing"]

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
  uniform float uGlow;
  varying vec3 vNormal;
  varying vec3 vView;

  void main() {
    vec3 normal = normalize(vNormal);
    float facing = clamp(dot(normal, normalize(vView)), 0.0, 1.0);
    float edge = smoothstep(0.35, 0.0, facing);   // 1 at the silhouette
    float light = 0.92 + 0.08 * normal.y;          // soft light from above
    vec3 body = mix(uBody * light, uEdge, 0.12 * (1.0 - normal.y)); // faint purple bounce below
    vec3 color = mix(body, uEdge, edge);
    // A violet rim brighter than white (the buffers are half float). Violet is dark to the eye,
    // so it takes several times white's energy to pass the bloom threshold, which the milky body
    // (luminance about 0.88) stays under: a violet glow, not a white haze.
    color += uEdge * uGlow * edge * edge;
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`

export default function create({ canvas, size, THREE, postprocessing }) {
  const { EffectComposer, RenderPass, EffectPass, Effect, BlendFunction, BloomEffect, ToneMappingEffect, ToneMappingMode } = postprocessing

  /**
   * Bloom adds light to RGB but leaves alpha 0 around the orb, so on a light
   * background the glow would vanish. Alpha as the brightest channel turns the
   * glow into valid premultiplied colour that shows on any background. Then
   * colour and alpha are dithered together, since the glow fades over many
   * pixels and would band in 8 bits.
   *
   * The composer converts to sRGB after this effect, so both happen in sRGB
   * terms and are converted back: near black, the sRGB curve would stretch a
   * linear dither of one level into a dozen.
   */
  class GlowAlphaEffect extends Effect {
    constructor() {
      super("GlowAlphaEffect", /* glsl */ `
        // @snippet ign
        // @needs none
        // @stage fragment
        // @use float v = ign(gl_FragCoord.xy);
        // Credit: Jorge Jimenez, "Next Generation Post Processing in Call of Duty: Advanced Warfare" (SIGGRAPH 2014), the algorithm. Glimt code. MIT.
        float ign(vec2 pixel) {
          return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
        }

        // @snippet ditherRgb
        // @needs none
        // @stage any
        // @use vec3 v = ditherRgb(vec3(vUv, 0.5), fract(vUv.x * 640.0));
        // Credit: Glimt, triangular-PDF dither as described by Mikkel Gjøl, "Banding in Games: A Noisy Rant" (Playdead, 2016). MIT.
        vec3 ditherRgb(vec3 color, float noise) {
          float n = noise * 2.0 - 1.0;
          n = sign(n) * (1.0 - sqrt(1.0 - abs(n))); // uniform to triangular, −1 … 1
          return color + n / 255.0;
        }

        // @snippet ditherRgba
        // @needs ditherRgb
        // @stage any
        // @use vec4 v = ditherRgba(vec4(vUv, 0.5, 0.5), fract(vUv.x * 640.0));
        // Credit: Glimt. MIT.
        vec4 ditherRgba(vec4 color, float noise) {
          vec3 rgb = ditherRgb(color.rgb, noise);
          // The same offset on alpha keeps premultiplied colour valid (rgb ≤ a).
          return clamp(vec4(rgb, color.a + (rgb.r - color.r)), 0.0, 1.0);
        }

        void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
          vec3 encoded = sRGBTransferOETF(vec4(inputColor.rgb, 1.0)).rgb;
          float glow = min(max(encoded.r, max(encoded.g, encoded.b)), 1.0);
          vec4 dithered = ditherRgba(vec4(encoded, max(inputColor.a, glow)), ign(gl_FragCoord.xy));
          outputColor = vec4(sRGBTransferEOTF(vec4(dithered.rgb, 1.0)).rgb, dithered.a);
        }`, { blendFunction: BlendFunction.SRC })
    }
  }

  // No antialias on the canvas: the composer renders into its own buffers.
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" })
  renderer.setClearColor(0x000000, 0) // transparent background
  renderer.toneMapping = THREE.NoToneMapping // the composer tone maps
  renderer.setPixelRatio(size.dpr)
  renderer.setSize(size.width, size.height, false) // false: an OffscreenCanvas has no CSS size to set
  // three.js only logs shader errors; throw so they reach last_error instead of leaving a blank area.
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    throw new Error("Shader failed: " + (gl.getShaderInfoLog(fs) || gl.getShaderInfoLog(vs) || gl.getProgramInfoLog(program) || "").trim())
  }

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(35, size.width / size.height, 0.1, 20)
  camera.position.z = 6

  const uniforms = {
    uTime: { value: 0 },
    uRipple: { value: 0 },
    uBody: { value: new THREE.Color("#f1efff") },
    uEdge: { value: new THREE.Color("#6055F7") },
    uGlow: { value: 1 },
  }
  const geometry = new THREE.IcosahedronGeometry(1, 24)
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader })
  const orb = new THREE.Mesh(geometry, material)
  scene.add(orb)

  // Half floats hold the rim's brighter-than-white light and keep the glow's falloff smooth.
  // No anti-aliasing: the soft rim and its glow hide the one silhouette, and MSAA on float
  // buffers is expensive on weak GPUs. A design with hard edges should add new FXAAEffect()
  // (cheaper) or pass multisampling: 4 here, and check the preview's frame time.
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType })
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new BloomEffect({
    mipmapBlur: true,
    luminanceThreshold: 0.92, // just above the body, see the fragment shader
    luminanceSmoothing: 0.08,
    intensity: 0.6,
    radius: 0.6,
    resolutionScale: 0.5, // blurry anyway, so half resolution costs a quarter
  })
  // Neutral tone mapping keeps the milky white white; AgX would turn it grey.
  const effects = [bloom, new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }), new GlowAlphaEffect()]
  composer.addPass(new EffectPass(camera, ...effects))

  let level = 0
  let ripple = 0
  let lastTime = 0

  return {
    render(sequences, state) {
      const phase = sequences[state.sequenceIndex]?.sequence[state.seq]?.phases[state.phase]
      if (!phase) return

      const dt = Math.min(Math.max(state.time - lastTime, 0), 0.1) // never negative: that would blow the glide up to NaN
      lastTime = state.time
      const moving = phase.type === "inhale" || phase.type === "exhale"
      level = approach(level, breathLevel(phase, state.progress), dt, 12)
      ripple = approach(ripple, moving ? 0.07 : 0.015, dt, 3)

      orb.scale.setScalar(0.55 + 0.45 * level)
      orb.rotation.y = state.time * 0.1
      uniforms.uTime.value = state.time % 3600 // floats lose precision as time grows
      uniforms.uRipple.value = ripple
      uniforms.uGlow.value = 6 + 5 * level
      bloom.intensity = 0.5 + 0.7 * level

      composer.render(dt)
    },

    resize(next) {
      renderer.setPixelRatio(next.dpr)
      composer.setSize(next.width, next.height, false) // resizes the renderer and every pass
      camera.aspect = next.width / next.height
      camera.updateProjectionMatrix()
    },

    dispose() {
      composer.dispose() // its buffers, passes and effects
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    },
  }
}
