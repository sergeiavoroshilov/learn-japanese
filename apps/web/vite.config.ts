import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Mic access needs a secure context. http://localhost counts as one, a LAN
// address does not — so testing on the phone needs `bun run dev:https`
// (self-signed cert, Safari will ask to trust it once).
const https = process.env.HTTPS === '1';

export default defineConfig({
  plugins: [react(), ...(https ? [basicSsl()] : [])],
  server: { port: 5173 },
});
