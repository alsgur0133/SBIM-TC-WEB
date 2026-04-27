# DWG → PDF 변환 설정

캐드 보기에서 DWG 파일을 PDF로 변환하려면 **환경변수 `DWG2PDF_CMD`**를 설정해야 합니다.

## 형식

- `%INPUT%` 또는 `%IN%`: 원본 DWG 파일 경로
- `%OUTPUT%` 또는 `%OUT%`: 출력 PDF 파일 경로

예:

- Windows: `set DWG2PDF_CMD="C:\path\to\dwg2pdf.exe" %INPUT% %OUTPUT%`
- Linux/Mac: `export DWG2PDF_CMD="dwg2pdf %INPUT% %OUTPUT%"`

## 변환기 예시

1. **LibreDWG + 스크립트**  
   - [LibreDWG](https://www.gnu.org/software/libredwg/)에서 `dwg2dxf`를 설치한 뒤, DXF를 PDF로 바꾸는 스크립트(예: Python ezdxf + reportlab)를 만들고, 그 스크립트를 `DWG2PDF_CMD`에 지정합니다.

2. **상용 변환기**  
   - DWG를 PDF로 저장할 수 있는 변환기(예: ODA, 상용 툴)의 실행 경로와 인자를 `DWG2PDF_CMD`에 맞게 설정합니다.

3. **포함된 Node 스크립트 (LibreDWG 필요)**  
   - 프로젝트에 `server/scripts/dwg2pdf.cjs`가 포함되어 있습니다.  
   - [LibreDWG](https://www.gnu.org/software/libredwg/)의 `dwg2dxf`가 설치되어 있어야 합니다.  
     - Windows: LibreDWG 빌드 후 `dwg2dxf.exe`를 PATH에 추가  
     - Ubuntu/Debian: `sudo apt install libredwg-tools`  
   - 환경변수 예시:
     - Windows: `set DWG2PDF_CMD=node server/scripts/dwg2pdf.cjs %INPUT% %OUTPUT%`
     - Linux/Mac: `export DWG2PDF_CMD="node server/scripts/dwg2pdf.cjs %INPUT% %OUTPUT%"`

`DWG2PDF_CMD`를 설정하지 않으면 DWG 파일은 변환되지 않고, 캐드 보기 시 "DWG 변환기가 설정되지 않았습니다" 오류가 반환됩니다.
