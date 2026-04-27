/**
 * pm2 등으로 Node를 상시 실행할 때 예시 (IIS ARR 역프록시 + Node 24)
 * 경로·이름만 서버에 맞게 수정 후:
 *   pm2 start ecosystem.config.cjs
 */
const path = require('path')
const fs = require('fs')

function resolveServerCwd () {
  const candidates = [
    path.join(__dirname, 'dist', 'server'),
    path.join(__dirname, 'publish-iis', 'dist', 'server'),
    path.join(__dirname, 'server'),
  ]
  return candidates.find((p) => fs.existsSync(path.join(p, 'index.js'))) || candidates[0]
}

module.exports = {
  apps: [
    {
      name: 'sbim-tc-web',
      cwd: resolveServerCwd(),
      script: 'index.js',
      instances: 1,
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        PORT: '5001',
        TRUST_PROXY: '1',
      },
    },
  ],
}
