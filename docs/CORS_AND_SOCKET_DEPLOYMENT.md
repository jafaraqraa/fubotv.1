# CORS and Socket.IO deployment

Configure browser origins explicitly. Values are origins only: scheme, hostname,
and optional port. Paths and trailing slashes are normalized away.

```env
FRONTEND_ORIGIN=https://app.example.com
ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
```

`FRONTEND_ORIGIN` is retained for single-origin deployments. Both variables are
combined and deduplicated. Production startup fails when both are empty.

For local development, list only the ports actually used:

```env
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173
```

## Nginx

- Proxy both HTTP API and `/socket.io/` to the same backend.
- Preserve the browser `Origin` header; do not rewrite it.
- Forward `Host`, `X-Forwarded-Proto`, and `X-Forwarded-For`.
- Enable WebSocket upgrade headers on `/socket.io/`.
- Do not add a second permissive `Access-Control-Allow-Origin` header in Nginx.

## Cloudflare and HTTPS

- Use Full (strict) TLS so the browser-facing origin remains HTTPS end to end.
- Enable WebSockets.
- Do not cache `/socket.io/`, authentication endpoints, API responses, or
  webhook POST requests.
- Add the public HTTPS frontend origin to the allowlist, not the internal
  container or upstream address.

The application trusts one reverse-proxy hop for secure session cookies.
Deployments with a different proxy topology must configure the trusted proxy
boundary deliberately rather than accepting arbitrary forwarded headers.

Requests without an `Origin` header remain available for health checks,
server-to-server calls, CLI clients, and Meta webhooks. Webhook signature
verification remains independent and mandatory when enabled.
