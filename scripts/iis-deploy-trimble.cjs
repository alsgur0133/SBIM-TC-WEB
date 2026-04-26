/**
 * npm run deploy:iis / build:iis 시 Trimble OAuth 값을 자동 적용합니다.
 * 콜백·앱 이름 변경: 아래 상수 또는 환경 변수 TRIMBLE_IIS_REDIRECT_URI 로 덮어쓰기.
 *
 * 배포 URL(예: https://develop.yunwootech.com/bracetc)과 Trimble Redirect URI 는 동일 경로로 맞추는 것이 안전합니다.
 */
const APP_NAME = 'SBIM-TC-WEB'
const CLIENT_ID = 'c47000c6-1dbb-4b83-8d81-46d317217ebc'
const CLIENT_SECRET = process.env.TRIMBLE_CLIENT_SECRET || ''
/** Trimble 앱에 등록한 Callback URL과 문자 단위로 동일해야 합니다. (HTTP·다른 포트면 TRIMBLE_IIS_REDIRECT_URI 로 지정) */
const DEFAULT_REDIRECT_URI = 'https://develop.yunwootech.com/bracetc'

const DEPLOY_TRIMBLE_SERVER_KEYS = [
  'TRIMBLE_CLIENT_ID',
  'TRIMBLE_CLIENT_SECRET',
  'TRIMBLE_REDIRECT_URI',
  'TRIMBLE_APP_NAME',
  'TRIMBLE_SCOPE',
]

function redirectUri () {
  const u = process.env.TRIMBLE_IIS_REDIRECT_URI
  return (typeof u === 'string' && u.trim()) ? u.trim() : DEFAULT_REDIRECT_URI
}

function getViteEnv () {
  const r = redirectUri()
  return {
    VITE_TRIMBLE_CLIENT_ID: CLIENT_ID,
    VITE_TRIMBLE_REDIRECT_URI: r,
    VITE_TRIMBLE_APP_NAME: APP_NAME,
    VITE_TRIMBLE_SCOPE: `openid ${APP_NAME}`,
    /** 내부 HTTP(dev)에서 임베드 뷰어 시도 */
    VITE_TRIMBLE_TRY_EMBED_ON_HTTP: '1',
  }
}

function getServerEnv () {
  const r = redirectUri()
  return {
    TRIMBLE_CLIENT_ID: CLIENT_ID,
    TRIMBLE_CLIENT_SECRET: CLIENT_SECRET,
    TRIMBLE_REDIRECT_URI: r,
    TRIMBLE_APP_NAME: APP_NAME,
    TRIMBLE_SCOPE: 'openid',
  }
}

module.exports = {
  APP_NAME,
  DEPLOY_TRIMBLE_SERVER_KEYS,
  getViteEnv,
  getServerEnv,
  redirectUri,
}
