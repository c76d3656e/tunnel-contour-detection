import type * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Line2 } from 'three/examples/jsm/lines/Line2.js'
import type { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { Meta, SliceResult } from '../types'
import type { PreviewFrame } from '../liveSlice'
import {
  defaultAppearance,
  hexToInt,
  hexToRgb,
  scaledCloudRgb,
  type Appearance,
} from '../appearance'

type ThreeNS = typeof import('three')

export interface OverlayFlags {
  slab: boolean
  contour: boolean
  fit: boolean
  horseshoe?: boolean
}

function makeSpriteTexture(THREE: ThreeNS): THREE.CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('无法创建点精灵画布')
  }
  const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 31)
  glow.addColorStop(0, 'rgba(255,255,255,1)')
  glow.addColorStop(0.28, 'rgba(255,255,255,0.82)')
  glow.addColorStop(0.62, 'rgba(255,255,255,0.22)')
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  return texture
}

function flattenXY(points: number[][], target: number[]): number {
  const n = points.length
  if (n === 0) return 0
  let w = 0
  for (let i = 0; i < n; i += 1) {
    const p = points[i]
    target[w] = p[0]
    target[w + 1] = p[1]
    target[w + 2] = 0
    w += 3
  }
  const first = points[0]
  const last = points[n - 1]
  if (n > 1 && (first[0] !== last[0] || first[1] !== last[1])) {
    target[w] = first[0]
    target[w + 1] = first[1]
    target[w + 2] = 0
    w += 3
  }
  return w / 3
}

export class TunnelViewer {
  private canvas: HTMLCanvasElement
  private ready: Promise<void>
  private disposed = false
  private THREE: ThreeNS | null = null
  private renderer: THREE.WebGLRenderer | null = null
  private scene: THREE.Scene | null = null
  private camera: THREE.PerspectiveCamera | null = null
  private controls: OrbitControls | null = null
  private cloud: THREE.Points | null = null
  private cloudMat: THREE.PointsMaterial | null = null
  private contourLine: Line2 | null = null
  private fitLine: Line2 | null = null
  private horseshoeLine: Line2 | null = null
  private contourGeom: LineGeometry | null = null
  private fitGeom: LineGeometry | null = null
  private horseshoeGeom: LineGeometry | null = null
  private contourMat: LineMaterial | null = null
  private fitMat: LineMaterial | null = null
  private horseshoeMat: LineMaterial | null = null
  private observer: ResizeObserver | null = null
  private raf = 0
  private lastTick = 0
  private fading = false
  private fade = 0
  private station = 0
  private stationPrimed = false
  private uvExtent = 4
  private reduceMotion = false
  private overlays: OverlayFlags = { slab: true, contour: true, fit: true, horseshoe: true }
  private look: Appearance = defaultAppearance()
  private lastMeta: Meta | null = null
  private yMin = 0
  private sliceUniforms: {
    uStation: { value: number }
    uHalf: { value: number }
    uOn: { value: number }
    uRangeLo: { value: number }
    uRangeHi: { value: number }
    uSliceRgb: { value: unknown }
    uBaseRgb: { value: unknown }
  } = {
    uStation: { value: 0 },
    uHalf: { value: 0.1 },
    uOn: { value: 1 },
    uRangeLo: { value: -1e6 },
    uRangeHi: { value: 1e6 },
    uSliceRgb: { value: hexToRgb('#e8b04a') },
    uBaseRgb: { value: scaledCloudRgb(defaultAppearance()) },
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.ready = this.boot()
  }

  async loadCloud(xyz: Float32Array, meta: Meta, station: number): Promise<void> {
    await this.ready
    if (this.disposed || !this.THREE || !this.scene) return
    const THREE = this.THREE
    const count = Math.floor(xyz.length / 3)
    this.uvExtent = meta.uv_extent
    this.station = station
    this.lastMeta = meta

    let yMin = Number.POSITIVE_INFINITY
    for (let i = 0; i < count; i += 1) {
      const y = xyz[i * 3 + 1]
      if (y < yMin) yMin = y
    }
    this.yMin = yMin

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(xyz, 3))
    geometry.computeBoundingSphere()

    const size = Math.min(0.04, Math.max(0.016, meta.uv_extent * 0.0036))
    const material = new THREE.PointsMaterial({
      size,
      map: makeSpriteTexture(THREE),
      color: 0xffffff,
      vertexColors: false,
      transparent: true,
      opacity: this.reduceMotion ? 1 : 0,
      depthWrite: false,
      sizeAttenuation: true,
      alphaTest: 0.04,
    })
    if (this.cloud) {
      this.scene.remove(this.cloud)
      this.cloud.geometry.dispose()
      this.cloudMat?.map?.dispose()
      this.cloudMat?.dispose()
    }
    this.hookSliceShader(material)
    this.cloud = new THREE.Points(geometry, material)
    this.cloud.frustumCulled = false
    this.cloudMat = material
    this.scene.add(this.cloud)
    this.fading = !this.reduceMotion
    this.fade = this.reduceMotion ? 1 : 0
    this.applyLook()

    this.placeHorizon(yMin, meta)
    this.stationPrimed = false
    this.setStation(station)
    this.resetCamera()
  }

  setStation(s: number): void {
    if (this.stationPrimed && this.camera && this.controls) {
      const dz = s - this.station
      this.camera.position.z += dz
      this.controls.target.z += dz
    }
    this.station = s
    this.stationPrimed = true
    this.sliceUniforms.uStation.value = s
    if (this.contourLine) this.contourLine.position.z = s
    if (this.fitLine) this.fitLine.position.z = s
    if (this.horseshoeLine) this.horseshoeLine.position.z = s
  }

  setThickness(thickness: number): void {
    this.sliceUniforms.uHalf.value = Math.max(0.01, thickness * 0.5)
  }

  setWorkingRange(lo: number, hi: number): void {
    this.sliceUniforms.uRangeLo.value = lo
    this.sliceUniforms.uRangeHi.value = hi
  }

  setAppearance(look: Appearance): void {
    this.look = look
    this.applyLook()
    if (this.lastMeta) this.placeHorizon(this.yMin, this.lastMeta)
  }

  setOverlays(flags: OverlayFlags): void {
    this.overlays = flags
    this.sliceUniforms.uOn.value = flags.slab ? 1 : 0
    if (this.contourLine) {
      this.contourLine.visible = flags.contour && Boolean(this.contourLine.userData.alive)
    }
    if (this.fitLine) {
      this.fitLine.visible = flags.fit && Boolean(this.fitLine.userData.alive)
    }
    if (this.horseshoeLine) {
      this.horseshoeLine.visible = Boolean(flags.horseshoe) && Boolean(this.horseshoeLine.userData.alive)
    }
  }

  applyPreview(frame: PreviewFrame): void {
    if (this.disposed) return
    this.updateLine(this.contourGeom, this.contourLine, this.overlays.contour, frame.contour_uv)
    this.updateLine(this.fitGeom, this.fitLine, this.overlays.fit, frame.fit_line)
    this.updateLine(this.horseshoeGeom, this.horseshoeLine, Boolean(this.overlays.horseshoe), frame.horseshoe_uv ?? [])
  }

  applySlice(slice: SliceResult): void {
    if (this.disposed) return
    this.applyPreview({
      s: slice.s,
      pointCount: slice.point_count,
      coverage: slice.angular_coverage,
      contour_uv: slice.contour_uv,
      fit: slice.fit,
      fit_line: slice.fit_line,
      horseshoe_uv: [],
      slab: [],
    })
  }

  resetCamera(): void {
    const camera = this.camera
    const controls = this.controls
    if (!camera || !controls) return
    const d = this.uvExtent * 1.8
    const s = this.station
    camera.up.set(0, 1, 0)
    camera.position.set(0.55 * d, 0.42 * d, s - 0.75 * d)
    controls.target.set(0, 0, s)
    camera.lookAt(0, 0, s)
    controls.update()
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.observer?.disconnect()
    this.controls?.dispose()
    this.cloud?.geometry.dispose()
    this.cloudMat?.map?.dispose()
    this.cloudMat?.dispose()
    this.contourGeom?.dispose()
    this.fitGeom?.dispose()
    this.horseshoeGeom?.dispose()
    this.contourMat?.dispose()
    this.fitMat?.dispose()
    this.horseshoeMat?.dispose()
    this.renderer?.dispose()
    this.renderer?.forceContextLoss()
  }

  private async boot(): Promise<void> {
    const [THREE, controlsMod, line2Mod, lineMatMod, lineGeomMod] = await Promise.all([
      import('three'),
      import('three/examples/jsm/controls/OrbitControls.js'),
      import('three/examples/jsm/lines/Line2.js'),
      import('three/examples/jsm/lines/LineMaterial.js'),
      import('three/examples/jsm/lines/LineGeometry.js'),
    ])
    if (this.disposed) return
    this.THREE = THREE

    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setClearColor(0x14110e, 1)
    renderer.sortObjects = false
    renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer = renderer

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x14110e)
    this.scene = scene

    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200)
    camera.up.set(0, 1, 0)
    this.camera = camera

    const controls = new controlsMod.OrbitControls(camera, this.canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.07
    controls.screenSpacePanning = true
    controls.minDistance = 0.6
    controls.maxDistance = 80
    controls.target.set(0, 0, 0)
    this.controls = controls

    this.buildLines(line2Mod.Line2, lineMatMod.LineMaterial, lineGeomMod.LineGeometry)

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(this.canvas.parentElement ?? this.canvas)
    this.resize()
    this.lastTick = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  private hookSliceShader(material: THREE.PointsMaterial): void {
    const uniforms = this.sliceUniforms
    material.customProgramCacheKey = () => 'cloud-slice-band-v3'
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uStation = uniforms.uStation
      shader.uniforms.uHalf = uniforms.uHalf
      shader.uniforms.uOn = uniforms.uOn
      shader.uniforms.uRangeLo = uniforms.uRangeLo
      shader.uniforms.uRangeHi = uniforms.uRangeHi
      shader.uniforms.uSliceRgb = uniforms.uSliceRgb
      shader.uniforms.uBaseRgb = uniforms.uBaseRgb
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uStation;
uniform float uHalf;
uniform float uOn;
uniform float uRangeLo;
uniform float uRangeHi;
varying float vSlice;
varying float vOutside;`,
        )
        .replace(
          '#include <color_vertex>',
          `#include <color_vertex>
{
  float d = abs(position.z - uStation);
  vSlice = uOn * (1.0 - smoothstep(uHalf * 0.72, uHalf, d));
  vOutside = 1.0 - step(uRangeLo, position.z) * step(position.z, uRangeHi);
}`,
        )
        .replace(
          '#include <fog_vertex>',
          `#include <fog_vertex>
gl_PointSize *= mix(1.0, 2.6, vSlice);`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform vec3 uSliceRgb;
uniform vec3 uBaseRgb;
varying float vSlice;
varying float vOutside;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  diffuseColor.rgb = mix(uBaseRgb, uSliceRgb, vSlice);
  diffuseColor.a = mix(diffuseColor.a * 0.72, 1.0, vSlice);
  diffuseColor.rgb *= mix(1.0, 0.28, vOutside);
  diffuseColor.a *= mix(1.0, 0.1, vOutside);
}`,
        )
    }
    material.needsUpdate = true
  }

  private applyLook(): void {
    if (!this.THREE) return
    const THREE = this.THREE
    const voidColor = this.look.theme === 'light' ? 0xe4ddd0 : 0x14110e
    this.renderer?.setClearColor(voidColor, 1)
    if (this.scene) this.scene.background = new THREE.Color(voidColor)
    const slice = hexToRgb(this.look.slice)
    const base = scaledCloudRgb(this.look)
    const sliceU = this.sliceUniforms.uSliceRgb
    const baseU = this.sliceUniforms.uBaseRgb
    if (!(sliceU.value instanceof THREE.Vector3)) {
      sliceU.value = new THREE.Vector3()
      baseU.value = new THREE.Vector3()
    }
    ;(sliceU.value as InstanceType<ThreeNS['Vector3']>).set(slice[0], slice[1], slice[2])
    ;(baseU.value as InstanceType<ThreeNS['Vector3']>).set(base[0], base[1], base[2])
    this.contourMat?.color.setHex(hexToInt(this.look.contour))
    this.fitMat?.color.setHex(hexToInt(this.look.fit))
    this.horseshoeMat?.color.setHex(hexToInt(this.look.design))
  }

  private buildLines(
    Line2Ctor: typeof Line2,
    LineMaterialCtor: typeof LineMaterial,
    LineGeometryCtor: typeof LineGeometry,
  ): void {
    this.contourGeom = new LineGeometryCtor()
    this.fitGeom = new LineGeometryCtor()
    this.horseshoeGeom = new LineGeometryCtor()
    this.contourGeom.setPositions([0, 0, 0, 0, 0, 0])
    this.fitGeom.setPositions([0, 0, 0, 0, 0, 0])
    this.horseshoeGeom.setPositions([0, 0, 0, 0, 0, 0])
    this.contourMat = new LineMaterialCtor({
      color: hexToInt(this.look.contour),
      linewidth: 3.1,
      dashed: false,
      transparent: true,
      opacity: 0.98,
      depthTest: true,
      worldUnits: false,
    })
    this.fitMat = new LineMaterialCtor({
      color: hexToInt(this.look.fit),
      linewidth: 2.2,
      dashed: false,
      transparent: true,
      opacity: 0.96,
      depthTest: true,
      worldUnits: false,
    })
    this.horseshoeMat = new LineMaterialCtor({
      color: hexToInt(this.look.design),
      linewidth: 2.4,
      dashed: true,
      dashSize: 0.12,
      gapSize: 0.08,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      worldUnits: false,
    })
    this.contourLine = new Line2Ctor(this.contourGeom, this.contourMat)
    this.fitLine = new Line2Ctor(this.fitGeom, this.fitMat)
    this.horseshoeLine = new Line2Ctor(this.horseshoeGeom, this.horseshoeMat)
    this.contourLine.frustumCulled = false
    this.fitLine.frustumCulled = false
    this.horseshoeLine.frustumCulled = false
    this.contourLine.renderOrder = 4
    this.fitLine.renderOrder = 4
    this.horseshoeLine.renderOrder = 5
    this.contourLine.visible = false
    this.fitLine.visible = false
    this.horseshoeLine.visible = false
    this.contourLine.userData.alive = false
    this.fitLine.userData.alive = false
    this.horseshoeLine.userData.alive = false
    this.scene!.add(this.contourLine)
    this.scene!.add(this.fitLine)
    this.scene!.add(this.horseshoeLine)
  }

  private placeHorizon(yMin: number, meta: Meta): void {
    if (!this.THREE || !this.scene) return
    const THREE = this.THREE
    const previous = this.scene.getObjectByName('horizon')
    if (previous) {
      this.scene.remove(previous)
      previous.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        mesh.geometry?.dispose()
        const mat = mesh.material
        if (Array.isArray(mat)) mat.forEach((item) => item.dispose())
        else mat?.dispose()
      })
    }
    const group = new THREE.Group()
    group.name = 'horizon'
    const spanZ = Math.max(4, (meta.dense_s_max ?? meta.s_max) - (meta.dense_s_min ?? meta.s_min))
    const size = Math.max(spanZ, meta.uv_extent) * 1.6
    const midZ = ((meta.dense_s_min ?? meta.s_min) + (meta.dense_s_max ?? meta.s_max)) * 0.5
    // Sit well below invert so the empty bore is scene void, not a dark slab
    // showing through the transparent points.
    const floorY = yMin - Math.max(1.6, meta.uv_extent * 0.45)
    const grid = new THREE.GridHelper(
      size,
      18,
      this.look.theme === 'light' ? 0x9a8f80 : 0x2c2620,
      this.look.theme === 'light' ? 0xb7ad9e : 0x221c18,
    )
    grid.position.set(0, floorY, midZ)
    const materials = Array.isArray(grid.material) ? grid.material : [grid.material]
    materials.forEach((mat) => {
      mat.transparent = true
      mat.opacity = this.look.theme === 'light' ? 0.28 : 0.16
      mat.depthWrite = false
    })
    group.add(grid)
    this.scene.add(group)
  }

  private updateLine(
    geometry: LineGeometry | null,
    line: Line2 | null,
    overlayOn: boolean,
    points: number[][],
  ): void {
    if (!geometry || !line) return
    if (points.length < 2) {
      line.visible = false
      line.userData.alive = false
      return
    }
    const buffer: number[] = []
    flattenXY(points, buffer)
    geometry.setPositions(buffer)
    line.computeLineDistances()
    line.position.z = this.station
    line.userData.alive = true
    line.visible = overlayOn
  }

  private resize = (): void => {
    const renderer = this.renderer
    const camera = this.camera
    if (!renderer || !camera || this.disposed) return
    const parent = this.canvas.parentElement ?? this.canvas
    const width = Math.max(1, parent.clientWidth)
    const height = Math.max(1, parent.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    this.contourMat?.resolution.set(width, height)
    this.fitMat?.resolution.set(width, height)
    this.horseshoeMat?.resolution.set(width, height)
  }

  private tick = (now: number): void => {
    if (this.disposed) return
    const dt = Math.min(0.05, (now - this.lastTick) / 1000)
    this.lastTick = now
    if (this.fading && this.cloudMat) {
      this.fade = Math.min(1, this.fade + dt * 1.35)
      this.cloudMat.opacity = this.fade
      if (this.fade >= 1) this.fading = false
    }
    this.controls?.update()
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera)
    }
    this.raf = requestAnimationFrame(this.tick)
  }
}
