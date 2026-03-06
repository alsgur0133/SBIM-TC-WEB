/**
 * web-ifc-three는 mergeGeometries를 사용하지만 three@0.149+는 mergeBufferGeometries만 export함.
 * IFCLoader.js를 mergeBufferGeometries 사용으로 패치합니다.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const target = path.join(__dirname, '../node_modules/web-ifc-three/IFCLoader.js')
if (!fs.existsSync(target)) {
  console.log('[patch-web-ifc-three] IFCLoader.js not found, skip.')
  process.exit(0)
}

let content = fs.readFileSync(target, 'utf8')
const needPatch =
  content.includes("from 'three/examples/jsm/utils/BufferGeometryUtils'") &&
  content.includes('mergeGeometries') &&
  !content.includes('mergeBufferGeometries')

if (!needPatch) {
  console.log('[patch-web-ifc-three] Already patched or different version, skip.')
  process.exit(0)
}

content = content.replace(
  "import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils';",
  "import { mergeBufferGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils';"
)
content = content.replace(/\bmergeGeometries\b/g, 'mergeBufferGeometries')

fs.writeFileSync(target, content)
console.log('[patch-web-ifc-three] Patched IFCLoader.js to use mergeBufferGeometries.')
