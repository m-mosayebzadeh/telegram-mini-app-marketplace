import react from '@vitejs/plugin-react'
// From 'vitest/config' (a superset of vite's) rather than plain 'vite'
// — that's what makes the `test` block below type-check; it has no
// effect on `vite dev`/`vite build`, which don't look at that block.
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
  },
  server: {
    // Vite rejects any request whose Host header isn't localhost/its own
    // configured hosts (DNS-rebinding protection) — without this, every
    // request coming through an ngrok tunnel gets a flat 403 Forbidden,
    // since ngrok's forwarded Host is a random *.ngrok-free.app domain
    // that changes on every restart (see docs/LOCAL_DEV.md), so there's
    // no fixed hostname to allowlist instead. This only affects `vite
    // dev` (never a production build), so disabling the check entirely
    // is a dev-only convenience, not a shipped security gap.
    allowedHosts: true,
    // Every backend call in this app goes to "/api/..." (see
    // src/lib/api.ts). Vite rewrites that to the real backend running
    // locally on :8000 and forwards the request server-side.
    //
    // Why proxy instead of calling the backend directly from the
    // browser: whatever origin serves THIS dev server is the only
    // origin Telegram's WebView ever talks to (see docs/TECHNICAL_REQUIREMENTS.md,
    // "local dev tunnel" — we tunnel this dev server, not the backend
    // separately) — so no CORS setup is needed on the backend at all,
    // in local dev or through the tunnel.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // Profile avatars are the one thing served as a plain public
      // static file (see backend/app/main.py's StaticFiles mount) — no
      // /api prefix/rewrite needed, just forwarded straight through.
      '/avatars': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
