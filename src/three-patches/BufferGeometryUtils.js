/**
 * three.js 0.149+ uses mergeBufferGeometries; web-ifc-three expects mergeGeometries.
 * Re-export with the old name for compatibility.
 */
export {
  mergeBufferGeometries as mergeGeometries,
} from '../../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js'
