import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // フロント開発サーバー(5173)からAPI(3001)を相対パスで叩けるようにする
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
})
