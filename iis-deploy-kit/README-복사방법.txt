================================================================================
  IIS 배포용 최소 파일 묶음 (iis-deploy-kit)
  다른 Vite + server(Node) 프로젝트 루트에 이 폴더 안 내용을 합치면 됩니다.
================================================================================

[ 폴더 안에 있는 것 ]
  scripts/build-for-iis.cjs      … 프론트 빌드 + publish-iis/dist 복사
  scripts/prepare-publish-iis.cjs … 루트 스크립트 호출(server → publish-iis\\dist\\server 만)
  web.config                      … 소스 루트 참고용. 배포 후 IIS 실제 경로 = publish-iis\\dist
  package-json에-추가할-scripts.txt
  vite.config-참고-베이스.txt

[ 하는 순서 ]
  1) 대상 프로젝트 루트( package.json 이 있는 곳 )에 열기
  2) 이 kit 의 scripts 폴더를 통째로 복사 → 프로젝트에 이미 scripts 가 있으면
     그 안에 두 파일만 넣기
  3) build-for-iis.cjs 맨 위 근처의 MY-APP 을 실제 IIS 서브경로 이름으로 변경
     (예: 사이트가 http://서버/MyProduct/ 이면 MyProduct)
  4) 백엔드 폴더가 server 가 아니면 prepare-publish-iis.cjs 안의
     path.join(root, 'server') 를 본인 폴더명으로 수정
  5) package.json 에 스크립트 세 줄 추가 (package-json에-추가할-scripts.txt 참고)
  6) vite.config 에 base 설정 (vite.config-참고-베이스.txt 참고)
  7) deploy:iis 가 publish-iis 에 web.config·server·dist 를 채움
  8) 터미널에서: npm install → npm run deploy:iis
  9) IIS 사이트 "실제 경로"는 publish-iis 폴더 루트 (dist 만 아님)

자세한 초보자 단계: docs/IIS배포-처음부터-초보자가이드.md
기술 상세·BASE_PATH·web.config 변형: docs/빌드배포-다른프로젝트에-적용하기.md

================================================================================
