/**
 * IFC 파일의 계층 구조를 읽어 콘솔에 출력하는 스크립트
 * 사용: node scripts/read-ifc-hierarchy.cjs "E:\경로\파일.ifc"
 */
const fs = require('fs');
const path = require('path');

const ifcPath = process.argv[2];
if (!ifcPath) {
  console.error('사용법: node scripts/read-ifc-hierarchy.cjs "IFC파일경로"');
  process.exit(1);
}

async function main() {
  const wasmDir = path.join(__dirname, '..', 'node_modules', 'web-ifc');
  const wasmPath = path.join(wasmDir, 'web-ifc.wasm');

  const { IfcAPI } = require('web-ifc');

  const api = new IfcAPI();
  await api.Init((filePath, prefix) => {
    if (filePath.endsWith('.wasm')) return wasmPath;
    return prefix + filePath;
  });

  if (!fs.existsSync(ifcPath)) {
    console.error('파일을 찾을 수 없습니다:', ifcPath);
    process.exit(1);
  }

  const buffer = new Uint8Array(fs.readFileSync(ifcPath));
  let modelID;
  try {
    modelID = api.OpenModel(buffer);
  } catch (e) {
    console.error('IFC 파일 열기 실패:', e.message);
    process.exit(1);
  }

  let root;
  try {
    root = await api.properties.getSpatialStructure(modelID, true);
  } catch (e) {
    console.error('계층 구조 읽기 실패:', e.message);
    process.exit(1);
  }

  function getLabel(node) {
    const name = node.Name?.value ?? node.name;
    if (name && String(name).trim()) return String(name).trim();
    return node.type || `#${node.expressID}`;
  }

  function printTree(node, indent = '') {
    const label = getLabel(node);
    console.log(`${indent}${node.type} (expressID: ${node.expressID}) ${label ? `- ${label}` : ''}`);
    const children = node.children ?? [];
    for (const child of children) {
      printTree(child, indent + '  ');
    }
  }

  console.log('=== IFC 계층 구조 ===');
  console.log('파일:', ifcPath);
  console.log('');
  printTree(root);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
