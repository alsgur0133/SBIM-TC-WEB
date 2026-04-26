/**
 * three.js 0.149+ uses mergeBufferGeometries.
 * Re-export both names so web-ifc-three (mergeBufferGeometries) and legacy (mergeGeometries) work.
 */
export {
  mergeBufferGeometries,
  mergeBufferGeometries as mergeGeometries,
} from '../../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js'
