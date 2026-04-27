# IFC 모델 뷰어 WASM 파일

모델 뷰어(모델 보기) 기능을 사용하려면 `web-ifc` 패키지의 WASM 파일을 이 폴더에 복사해야 합니다.

1. `npm install` 실행 후
2. `node_modules/web-ifc/web-ifc.wasm` 파일을 이 폴더에 `web-ifc.wasm` 이름으로 복사하세요.

Windows (PowerShell):
```powershell
Copy-Item node_modules\web-ifc\web-ifc.wasm public\wasm\web-ifc.wasm
```

Mac/Linux:
```bash
cp node_modules/web-ifc/web-ifc.wasm public/wasm/web-ifc.wasm
```
