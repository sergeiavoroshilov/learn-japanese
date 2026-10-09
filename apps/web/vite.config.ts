import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Mic access needs a secure context. http://localhost counts as one, a LAN
// address does not — so testing on the phone needs `bun run dev:https`
// (self-signed cert, Safari will ask to trust it once).
const https = process.env.HTTPS === '1';

export default defineConfig({
  plugins: [react(), ...(https ? [basicSsl()] : [])],
  // 5173 is taken by a trading terminal on this machine. strictPort makes Vite
  // fail loudly instead of sliding to the next free port, which would leave the
  // phone and the docs pointing at nothing.
  server: { port: 5174, strictPort: true },
});
