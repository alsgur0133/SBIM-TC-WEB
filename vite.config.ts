import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 배포 시 서브경로 사용 시: VITE_BASE_PATH=bracetc npm run build (또는 npm run build:iis 기본값)
const basePath = process.env.VITE_BASE_PATH
const basePathNorm = basePath ? basePath.replace(/^\/|\/$/g, '') : ''
const base = basePathNorm ? `/${basePathNorm}/` : '/'

export default defineConfig({
  base,
  /** API base 보정(getApiBase)에서 서브경로 고정 — shell 만으로는 import.meta.env 에 안 들어갈 수 있음 */
  define: basePathNorm
    ? { 'import.meta.env.VITE_BASE_PATH': JSON.stringify(basePathNorm) }
    : {},
  plugins: [react()],
  optimizeDeps: {
    // web-ifc-three가 three를 subpath로 불러오므로, pre-bundle 시 alias가 적용되도록 제외
    exclude: ['web-ifc-three'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // web-ifc-three imports mergeGeometries; three@0.149+ exports mergeBufferGeometries
      'three/examples/jsm/utils/BufferGeometryUtils': path.resolve(
        __dirname,
        'src/three-patches/BufferGeometryUtils.js'
      ),
      'three/examples/jsm/utils/BufferGeometryUtils.js': path.resolve(
        __dirname,
        'src/three-patches/BufferGeometryUtils.js'
      ),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      // 서브경로 빌드로 dev 실행 시 요청이 /bracetc/api/... 가 되므로 별도 프록시 필요
      ...(basePathNorm
        ? {
            [`/${basePathNorm}/api`]: {
              target: 'http://127.0.0.1:5001',
              changeOrigin: true,
              rewrite: (p) => p.replace(new RegExp(`^/${basePathNorm}`), '') || '/',
            },
          }
        : {}),
      '/api': {
        // 127.0.0.1 사용: localhost가 IPv6(::1)로 해석되면 ECONNREFUSED 나는 경우 방지
        target: 'http://127.0.0.1:5001',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.warn('[Vite proxy] API 서버(5001)에 연결할 수 없습니다. "npm run server" 실행 후 다시 시도하세요.', err.message)
          })
        },
      },
    },
  },
})
