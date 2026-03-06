import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/** DXF 파싱 결과 타입 (dxf-parser 호환) */
interface DxfEntity {
  type: string
  vertices?: { x: number; y: number; z?: number }[]
  startPoint?: { x: number; y: number; z?: number }
  endPoint?: { x: number; y: number; z?: number }
  center?: { x: number; y: number; z?: number }
  radius?: number
  shape?: boolean
  startAngle?: number
  endAngle?: number
}

interface ParsedDxf {
  entities: DxfEntity[]
}

function expandBounds(
  min: THREE.Vector2,
  max: THREE.Vector2,
  x: number,
  y: number
) {
  if (typeof x !== 'number' || typeof y !== 'number') return
  min.x = Math.min(min.x, x)
  min.y = Math.min(min.y, y)
  max.x = Math.max(max.x, x)
  max.y = Math.max(max.y, y)
}

function expandFromEntity(min: THREE.Vector2, max: THREE.Vector2, e: DxfEntity) {
  if (e.vertices) {
    for (const v of e.vertices) expandBounds(min, max, v.x, v.y)
  }
  if (e.type === 'LINE') {
    if (e.vertices && e.vertices.length >= 2) {
      expandBounds(min, max, e.vertices[0].x, e.vertices[0].y)
      expandBounds(min, max, e.vertices[1].x, e.vertices[1].y)
    } else if (e.startPoint && e.endPoint) {
      expandBounds(min, max, e.startPoint.x, e.startPoint.y)
      expandBounds(min, max, e.endPoint.x, e.endPoint.y)
    }
  }
  if (e.type === 'LWPOLYLINE' && e.vertices) {
    for (const v of e.vertices) expandBounds(min, max, v.x, v.y)
  }
  if (e.type === 'CIRCLE' && e.center && e.radius != null) {
    const r = e.radius
    expandBounds(min, max, e.center.x - r, e.center.y - r)
    expandBounds(min, max, e.center.x + r, e.center.y + r)
  }
  if (e.type === 'ARC' && e.center && e.radius != null) {
    const r = e.radius
    expandBounds(min, max, e.center.x - r, e.center.y - r)
    expandBounds(min, max, e.center.x + r, e.center.y + r)
  }
}

function buildSceneFromDxf(dxf: ParsedDxf, scene: THREE.Scene) {
  const material = new THREE.LineBasicMaterial({ color: 0x000000 })
  const min = new THREE.Vector2(Infinity, Infinity)
  const max = new THREE.Vector2(-Infinity, -Infinity)
  for (const e of dxf.entities) expandFromEntity(min, max, e)
  if (min.x === Infinity) {
    min.set(0, 0)
    max.set(100, 100)
  }
  const padding = Math.max((max.x - min.x), (max.y - min.y), 10) * 0.1
  min.subScalar(padding)
  max.addScalar(padding)

  for (const e of dxf.entities) {
    try {
      if (e.type === 'LINE') {
        let p0: { x: number; y: number } | undefined
        let p1: { x: number; y: number } | undefined
        if (e.vertices && e.vertices.length >= 2) {
          p0 = e.vertices[0]
          p1 = e.vertices[1]
        } else if (e.startPoint && e.endPoint) {
          p0 = e.startPoint
          p1 = e.endPoint
        }
        if (p0 && p1) {
          const geom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(p0.x, p0.y, 0),
            new THREE.Vector3(p1.x, p1.y, 0),
          ])
          const line = new THREE.Line(geom, material)
          scene.add(line)
        }
      } else if (e.type === 'LWPOLYLINE' && e.vertices && e.vertices.length >= 2) {
        const points: THREE.Vector3[] = e.vertices.map(
          (v) => new THREE.Vector3(v.x, v.y, 0)
        )
        if (e.shape && points.length >= 2) {
          points.push(points[0].clone())
        }
        const geom = new THREE.BufferGeometry().setFromPoints(points)
        const line = new THREE.Line(geom, material)
        scene.add(line)
      } else if (e.type === 'CIRCLE' && e.center != null && e.radius != null) {
        const r = e.radius
        if (r > 0 && r < 1e8) {
          const curve = new THREE.EllipseCurve(
            e.center.x, e.center.y, r, r, 0, Math.PI * 2, false, 0
          )
          const pts = curve.getPoints(64)
          const points = pts.map((p) => new THREE.Vector3(p.x, p.y, 0))
          const geom = new THREE.BufferGeometry().setFromPoints(points)
          const line = new THREE.Line(geom, material)
          scene.add(line)
        }
      } else if (e.type === 'ARC' && e.center != null && e.radius != null) {
        const r = e.radius
        const start = (e.startAngle != null ? e.startAngle : 0) * (Math.PI / 180)
        const end = (e.endAngle != null ? e.endAngle : 360) * (Math.PI / 180)
        if (r > 0 && r < 1e8) {
          const curve = new THREE.EllipseCurve(
            e.center.x, e.center.y, r, r, start, end, false, 0
          )
          const pts = curve.getPoints(32)
          const points = pts.map((p) => new THREE.Vector3(p.x, p.y, 0))
          const geom = new THREE.BufferGeometry().setFromPoints(points)
          const line = new THREE.Line(geom, material)
          scene.add(line)
        }
      }
    } catch (_) {
      // skip unsupported entity
    }
  }
  return { min, max }
}

interface DxfViewerProps {
  /** 서버에서 파싱된 DXF JSON URL (GET .../file/dxf/json) */
  dxfJsonUrl: string
  onError?: (message: string) => void
  onReady?: () => void
}

export default function DxfViewer({ dxfJsonUrl, onError, onReady }: DxfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<{
    scene: THREE.Scene
    camera: THREE.OrthographicCamera
    renderer: THREE.WebGLRenderer
    bbox: { min: THREE.Vector2; max: THREE.Vector2 }
  } | null>(null)

  useEffect(() => {
    if (!dxfJsonUrl) return
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let innerCleanup: (() => void) | null = null
    const width = container.clientWidth
    const height = container.clientHeight

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xffffff)
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000)
    camera.position.set(0, 0, 500)
    camera.lookAt(0, 0, 0)
    camera.up.set(0, 1, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    const resize = () => {
      if (!containerRef.current || !sceneRef.current) return
      const w = containerRef.current.clientWidth
      const h = containerRef.current.clientHeight
      sceneRef.current.renderer.setSize(w, h)
      if (sceneRef.current.bbox) {
        const { min, max } = sceneRef.current.bbox
        const cx = (min.x + max.x) / 2
        const cy = (min.y + max.y) / 2
        const size = Math.max(max.x - min.x, max.y - min.y, 1) / 2
        const aspect = w / h
        if (aspect >= 1) {
          sceneRef.current.camera.left = -size * aspect
          sceneRef.current.camera.right = size * aspect
          sceneRef.current.camera.top = size
          sceneRef.current.camera.bottom = -size
        } else {
          sceneRef.current.camera.left = -size
          sceneRef.current.camera.right = size
          sceneRef.current.camera.top = size / aspect
          sceneRef.current.camera.bottom = -size / aspect
        }
        sceneRef.current.camera.position.set(cx, cy, 500)
        sceneRef.current.camera.lookAt(cx, cy, 0)
        sceneRef.current.camera.updateProjectionMatrix()
      }
    }

    fetch(dxfJsonUrl)
      .then((res) => res.json().then((data: { success?: boolean; error?: string; entities?: DxfEntity[] }) => ({ res, data })))
      .then(({ res, data }) => {
        if (cancelled) return null
        if (!res.ok) {
          throw new Error((data && data.error) || `요청 실패 (${res.status})`)
        }
        if (!data || !data.entities || !Array.isArray(data.entities)) {
          throw new Error(data?.error || 'DXF 데이터를 불러올 수 없습니다.')
        }
        const dxf: ParsedDxf = { entities: data.entities }
        if (dxf.entities.length === 0) {
          throw new Error('DXF에 도형이 없습니다.')
        }
        return dxf
      })
      .then((dxf) => {
        if (cancelled || !dxf) return
        const bbox = buildSceneFromDxf(dxf, scene)
        sceneRef.current = { scene, camera, renderer, bbox }
        const { min, max } = bbox
        const cx = (min.x + max.x) / 2
        const cy = (min.y + max.y) / 2
        const size = Math.max(max.x - min.x, max.y - min.y, 1) / 2
        const aspect = width / height
        if (aspect >= 1) {
          camera.left = -size * aspect
          camera.right = size * aspect
          camera.top = size
          camera.bottom = -size
        } else {
          camera.left = -size
          camera.right = size
          camera.top = size / aspect
          camera.bottom = -size / aspect
        }
        camera.position.set(cx, cy, 500)
        camera.lookAt(cx, cy, 0)
        camera.updateProjectionMatrix()

        let isDown = false
        let prevX = 0
        let prevY = 0
        const pan = new THREE.Vector2(0, 0)
        let zoom = 1

        const onMouseDown = (ev: MouseEvent) => {
          isDown = true
          prevX = ev.clientX
          prevY = ev.clientY
        }
        const onMouseMove = (ev: MouseEvent) => {
          if (!isDown || !sceneRef.current) return
          pan.x += (ev.clientX - prevX) * 0.5
          pan.y -= (ev.clientY - prevY) * 0.5
          prevX = ev.clientX
          prevY = ev.clientY
          const { camera: cam } = sceneRef.current
          cam.position.x = cx + pan.x
          cam.position.y = cy + pan.y
          cam.lookAt(cx + pan.x, cy + pan.y, 0)
        }
        const onMouseUp = () => { isDown = false }
        const onWheel = (ev: WheelEvent) => {
          if (!sceneRef.current) return
          ev.preventDefault()
          const delta = ev.deltaY > 0 ? 0.9 : 1.1
          zoom *= delta
          zoom = Math.max(0.1, Math.min(100, zoom))
          const s = size / zoom
          const a = width / height
          if (a >= 1) {
            sceneRef.current.camera.left = -s * a
            sceneRef.current.camera.right = s * a
            sceneRef.current.camera.top = s
            sceneRef.current.camera.bottom = -s
          } else {
            sceneRef.current.camera.left = -s
            sceneRef.current.camera.right = s
            sceneRef.current.camera.top = s / a
            sceneRef.current.camera.bottom = -s / a
          }
          sceneRef.current.camera.updateProjectionMatrix()
        }
        renderer.domElement.addEventListener('mousedown', onMouseDown)
        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup', onMouseUp)
        renderer.domElement.addEventListener('wheel', onWheel, { passive: false })

        onReady?.()
        let rafId: number
        const animate = () => {
          rafId = requestAnimationFrame(animate)
          if (sceneRef.current) renderer.render(scene, camera)
        }
        animate()

        innerCleanup = () => {
          cancelAnimationFrame(rafId)
          renderer.domElement.removeEventListener('mousedown', onMouseDown)
          window.removeEventListener('mousemove', onMouseMove)
          window.removeEventListener('mouseup', onMouseUp)
          renderer.domElement.removeEventListener('wheel', onWheel)
        }
      })
      .catch((err) => {
        if (!cancelled) onError?.(err?.message || 'DXF 로드 실패')
        container.removeChild(renderer.domElement)
        renderer.dispose()
      })

    window.addEventListener('resize', resize)
    return () => {
      cancelled = true
      innerCleanup?.()
      window.removeEventListener('resize', resize)
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
      renderer.dispose()
      sceneRef.current = null
    }
  }, [dxfJsonUrl, onError, onReady])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', minHeight: 300, background: '#fff' }}
    />
  )
}
