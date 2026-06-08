import express from 'express';
import path from 'path';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { ClientRequest, IncomingMessage, ServerResponse } from 'http';

const app = express();
const PORT = process.env.PORT || 8090;
const API_GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://localhost:8080';

// Proxy /api/* to the api-gateway — keeps everything same-origin, no CORS needed
app.use('/api', createProxyMiddleware({
  target: API_GATEWAY_URL,
  changeOrigin: true,
  onProxyReq: (proxyReq: ClientRequest) => {
    // Strip Origin so the gateway doesn't treat this as a cross-origin request.
    // This is a server-to-server call; CORS is not needed here.
    proxyReq.removeHeader('origin');
    proxyReq.removeHeader('referer');
  },
  onError: (err: Error, _req: IncomingMessage, res: ServerResponse) => {
    console.error('[proxy error]', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'API gateway unavailable' }));
  },
}));

app.use(express.static(path.join(__dirname, 'public')));

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Demo UI running at http://localhost:${PORT}`);
    console.log(`Proxying /api/* → ${API_GATEWAY_URL}`);
  });
}

export { app };
