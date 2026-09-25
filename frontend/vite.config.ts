import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
// From 'vitest/config' (a superset of vite's) rather than plain 'vite'
// — that's what makes the `test` block below type-check; it has no
// effect on `vite dev`/`vite build`, which don't look at that block.
import { defineConfig } from 'vitest/config'

/**
 * Serve over https, for testing on a phone.
 *
 * Browsers only hand a page the microphone (and the camera) when it is a
 * secure context. localhost counts; a network address like
 * http://192.168.x.x does not — so on a phone the voice button had
 * nothing to record with. `npm run dev:phone` turns this on.
 *
 * Chosen with vite's own --mode rather than an environment variable, so
 * the same command works on Windows and everywhere else without an extra
 * tool to set the variable.
 *
 * Off by default, because the Telegram path goes through an ngrok tunnel
 * that is already https and forwards to plain http here; serving https in
 * that case would break the tunnel.
 *
 * The certificate is generated on the fly into node_modules and never
 * touches the repository — certificates are not to be committed. The
 * phone shows a one-time warning about it, which is expected for a
 * development certificate.
 */
// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: mode === 'phone' ? [react(), basicSsl()] : [react()],
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
        // The live connection (src/lib/live.ts) is a websocket under the
        // same prefix, and the proxy only forwards the upgrade when asked.
        ws: true,
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
}))
