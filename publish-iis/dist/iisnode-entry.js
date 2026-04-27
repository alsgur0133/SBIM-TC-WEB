/**
 * IIS + iisnode: 핸들러 path 를 dist 루트의 단일 .js 로 두면 하위 경로(server/index.js)에서
 * 500 이 나는 환경이 줄어듭니다. 실제 앱은 server/index.js 입니다.
 *
 * dist 루트에는 프로젝트 package.json(type=module)이 같이 복사되므로 require()를 쓰면
 * "require is not defined in ES module scope"로 Node가 시작 직후 종료됩니다.
 */
import './server/index.js'
