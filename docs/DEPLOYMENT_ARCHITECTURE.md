# Decoupled Deployment Architecture

This document outlines the recommended deployment methodologies, models, and environments for hosting the separated frontend and backend applications of the FUThing customer support platform.

---

## Deployment Model A: Decoupled Multi-Domain Subdomains (Recommended)

In this model, the frontend application and backend server run on completely independent domains, enabling independent scale-out, caching, and CDNs.

*   **Frontend URL:** `https://dashboard.futher.com`
*   **Backend URL:** `https://api.futher.com`

```
  [Browser Client]
    │      │
    │      └───────────── HTTP Requests ──> [ Frontend Host / Vercel / Netlify ] (Port 443)
    │                                        (Serves login.html, dashboard.html, etc.)
    │
    └────────── API / Socket.IO / CORS ───> [ Backend Host / ECS / VPS ] (Port 3005)
                                             (Executes database, webhooks, SQLite)
```

### CORS & Security Configuration:
*   **Backend `.env`:**
    ```ini
    NODE_ENV=production
    PORT=3005
    FRONTEND_ORIGIN=https://dashboard.futher.com
    COOKIE_SAMESITE=lax
    COOKIE_DOMAIN=.futher.com
    SESSION_SECRET=long_secure_production_secret_key
    ```
*   **Frontend `.env`:**
    ```ini
    FRONTEND_PORT=5173
    API_BASE_URL=https://api.futher.com/api/v1
    SOCKET_URL=https://api.futher.com
    ```

---

## Deployment Model B: Consolidated Reverse Proxy (Single-Domain Setup)

In this model, a single load balancer or reverse proxy (such as Nginx, Cloudflare Tunnel, or AWS ALB) routes traffic to both applications based on URI path rules. This eliminates cross-origin complexities entirely.

*   **Public Domain:** `https://dashboard.futher.com`
*   **Routing Rules:**
    *   `/api/*` ──────> Route to Backend Server (`http://localhost:3005/api/*`)
    *   `/socket.io/*` ──> Route to Backend Server (`http://localhost:3005/socket.io/*`)
    *   `/webhook` ────> Route to Backend Server (`http://localhost:3005/webhook`)
    *   `/uploads/*` ──> Route to Backend Server (`http://localhost:3005/uploads/*`)
    *   `/*` ──────────> Route to Frontend Static Server (`http://localhost:5173/*`)

```
                        [ Nginx / Reverse Proxy ] (HTTPS: 443)
                                │          │
            (Paths: /api, /socket.io, etc.)   (Paths: /login, /dashboard, etc.)
                                │          │
                                ▼          ▼
                       [Backend Process]  [Frontend Process]
                         (Port 3005)         (Port 5173)
```

### CORS & Security Configuration:
*   **Backend `.env`:**
    ```ini
    NODE_ENV=production
    PORT=3005
    FRONTEND_ORIGIN=https://dashboard.futher.com
    COOKIE_SAMESITE=lax
    SESSION_SECRET=long_secure_production_secret_key
    ```
*   **Frontend `.env`:**
    ```ini
    FRONTEND_PORT=5173
    API_BASE_URL=https://dashboard.futher.com/api/v1
    SOCKET_URL=https://dashboard.futher.com
    ```

---

## Production Security Checklist

1.  **Enforce HTTPS:** All domains must run strictly over TLS/SSL (HTTPS). Ensure TLS certs are up to date and automatically renewed.
2.  **HSTS Headers:** Secure server headers must activate HTTP Strict Transport Security (HSTS) inside `app.js` using strict policies.
3.  **Encrypted Session Storage:** The `SESSION_SECRET` must be set to a cryptographically random 64-character hex string.
4.  **Persistent SQLite WAL Mode:** Maintain SQLite on standard SSD storage with WAL journaling active to withstand outages and avoid latency.
