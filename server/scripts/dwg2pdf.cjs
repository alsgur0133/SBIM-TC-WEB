/**
 * DWG → PDF 변환 스크립트 (LibreDWG dwg2dxf + dxf-parser + pdf-lib)
 * 사용: node server/scripts/dwg2pdf.cjs <input.dwg> <output.pdf>
 * 요구: PATH에 dwg2dxf (LibreDWG) 설치 필요
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const inputPath = process.argv[2]
const outputPath = process.argv[3]

if (!inputPath || !outputPath) {
  console.error('Usage: node dwg2pdf.cjs <input.dwg> <output.pdf>')
  process.exit(1)
}

if (!fs.existsSync(inputPath)) {
  console.error('Input file not found:', inputPath)
  process.exit(1)
}

const inputDir = path.dirname(path.resolve(inputPath))
const inputBase = path.basename(inputPath, path.extname(inputPath))
const dxfPath = path.join(inputDir, inputBase + '.dxf')

try {
  // 1) DWG → DXF (LibreDWG dwg2dxf)
  execSync(`dwg2dxf -o "${dxfPath}" -y "${path.resolve(inputPath)}"`, {
    stdio: 'pipe',
    maxBuffer: 50 * 1024 * 1024,
    timeout: 60000,
  })
} catch (e) {
  console.error('dwg2dxf failed. Is LibreDWG installed? (e.g. apt install libredwg-tools)')
  console.error(e.message || e)
  process.exit(1)
}

if (!fs.existsSync(dxfPath)) {
  console.error('DXF file was not created:', dxfPath)
  process.exit(1)
}

// 2) DXF 파싱 및 PDF 생성
const DxfParser = require('dxf-parser')
const { PDFDocument, rgb } = require('pdf-lib')

const dxfText = fs.readFileSync(dxfPath, 'utf8')
const parser = new DxfParser()
let dxf
try {
  dxf = parser.parseSync(dxfText)
} catch (e) {
  try {
    dxf = parser.parse(dxfText)
  } catch (e2) {
    console.error('DXF parse error:', e2.message || e2)
    try { fs.unlinkSync(dxfPath) } catch (_) {}
    process.exit(1)
  }
}

try { fs.unlinkSync(dxfPath) } catch (_) {}

if (!dxf || !dxf.entities || dxf.entities.length === 0) {
  console.error('No entities in DXF')
  process.exit(1)
}

// 경계 계산
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

function expandBounds(x, y) {
  if (typeof x === 'number' && typeof y === 'number') {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
}

function expandFromEntity(e) {
  if (e.vertices) {
    for (const v of e.vertices) expandBounds(v.x, v.y)
  }
  if (e.type === 'LINE') {
    if (e.vertices && e.vertices.length >= 2) {
      expandBounds(e.vertices[0].x, e.vertices[0].y)
      expandBounds(e.vertices[1].x, e.vertices[1].y)
    } else if (e.startPoint && e.endPoint) {
      expandBounds(e.startPoint.x, e.startPoint.y)
      expandBounds(e.endPoint.x, e.endPoint.y)
    }
  }
  if (e.type === 'LWPOLYLINE' && e.vertices) {
    for (const v of e.vertices) expandBounds(v.x, v.y)
  }
  if (e.type === 'CIRCLE' && e.center) {
    const r = e.radius || 0
    expandBounds(e.center.x - r, e.center.y - r)
    expandBounds(e.center.x + r, e.center.y + r)
  }
  if (e.type === 'ARC' && e.center) {
    const r = e.radius || 0
    expandBounds(e.center.x - r, e.center.y - r)
    expandBounds(e.center.x + r, e.center.y + r)
  }
}

for (const e of dxf.entities) expandFromEntity(e)

if (minX === Infinity) {
  minX = 0
  minY = 0
  maxX = 100
  maxY = 100
}

const padding = 20
const width = Math.max(100, maxX - minX + padding * 2)
const height = Math.max(100, maxY - minY + padding * 2)
const scale = Math.min(550 / width, 800 / height)
const pageWidth = Math.ceil(width * scale) + 40
const pageHeight = Math.ceil(height * scale) + 40

const pdfDoc = PDFDocument.create()
const page = pdfDoc.addPage([pageWidth, pageHeight])

const ox = padding * scale + 20
const oy = pageHeight - (padding * scale + 20)

function toPdfX(x) {
  return ox + (x - minX) * scale
}
function toPdfY(y) {
  return oy - (y - minY) * scale
}

const black = rgb(0, 0, 0)

for (const e of dxf.entities) {
  try {
    let p0, p1
    if (e.type === 'LINE') {
      if (e.vertices && e.vertices.length >= 2) {
        p0 = e.vertices[0]
        p1 = e.vertices[1]
      } else if (e.startPoint && e.endPoint) {
        p0 = e.startPoint
        p1 = e.endPoint
      }
      if (p0 && p1) {
        page.drawLine({
          start: { x: toPdfX(p0.x), y: toPdfY(p0.y) },
          end: { x: toPdfX(p1.x), y: toPdfY(p1.y) },
          thickness: 0.5,
          color: black,
        })
      }
    } else if (e.type === 'LWPOLYLINE' && e.vertices && e.vertices.length >= 2) {
      for (let i = 0; i < e.vertices.length - 1; i++) {
        const v0 = e.vertices[i]
        const v1 = e.vertices[i + 1]
        page.drawLine({
          start: { x: toPdfX(v0.x), y: toPdfY(v0.y) },
          end: { x: toPdfX(v1.x), y: toPdfY(v1.y) },
          thickness: 0.5,
          color: black,
        })
      }
      if (e.shape && e.vertices.length >= 2) {
        const v0 = e.vertices[0]
        const v1 = e.vertices[e.vertices.length - 1]
        page.drawLine({
          start: { x: toPdfX(v0.x), y: toPdfY(v0.y) },
          end: { x: toPdfX(v1.x), y: toPdfY(v1.y) },
          thickness: 0.5,
          color: black,
        })
      }
    } else if (e.type === 'CIRCLE' && e.center) {
      const r = (e.radius || 0) * scale
      if (r > 0 && r < 10000) {
        page.drawCircle({
          x: toPdfX(e.center.x),
          y: toPdfY(e.center.y),
          size: r,
          borderColor: black,
          borderWidth: 0.5,
        })
      }
    }
  } catch (_) {}
}

;(async () => {
  try {
    const buf = await pdfDoc.save()
    fs.writeFileSync(outputPath, buf)
  } catch (err) {
    console.error('PDF save error:', err.message || err)
    process.exit(1)
  }
})()
