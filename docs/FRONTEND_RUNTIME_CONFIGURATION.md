# Frontend Runtime Configuration Model

This document outlines how the decoupled frontend retrieves configuration values dynamically without requiring complex bundlers, compilation, or build-time environment injections.

---

## The Dynamic `/config.js` Pattern

Rather than hardcoding development ports or requiring different bundles for staging and production environments, the frontend requests a dynamic, environment-backed configuration script from its local static server upon boot.

```
 [Browser Client]               [Frontend Server]               [System Env]
        │                              │                             │
        ├────── GET /config.js ───────>┤                             │
        │                              ├──── Reads env variables ───>┤ (API_BASE_URL)
        │                              │                             │
        │<───── Serves Script ─────────┤                             │
        │   (window.ENV = { ... })     │                             │
```

### Server Side Generation (`frontend/server.js`)
The frontend server dynamically generates `/config.js` by responding to the endpoint with a custom JavaScript file:

```javascript
app.get('/config.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`window.ENV = {
  API_BASE_URL: ${JSON.stringify(process.env.API_BASE_URL || 'http://localhost:3005/api/v1')},
  SOCKET_URL: ${JSON.stringify(process.env.SOCKET_URL || 'http://localhost:3005')}
};`);
});
```

### Client Side Integration (`dashboard.html` / `login.html`)
The client HTML document includes this script at the very top of its script execution list:

```html
<head>
    ...
    <script src="/config.js"></script>
    <script src="/js/dashboard/state.js"></script>
    <script src="/js/dashboard/api.js"></script>
    ...
</head>
```

Upon load, the script binds a global variable `window.ENV` containing the configuration keys.

---

## Client API and Socket Resolution

All client-side API requests and socket setups query `window.ENV` before falling back to default relative paths.

### 1. Unified REST Client (`api.js`)
```javascript
const baseUrl = window.ENV ? window.ENV.API_BASE_URL : '/api/v1';
const response = await fetch(`${baseUrl}/auth/csrf-token`, { credentials: 'include' });
```

### 2. Socket.IO Setup (`realtime.js`)
```javascript
const socketUrl = window.ENV ? window.ENV.SOCKET_URL : '';
const socket = io(socketUrl, {
    withCredentials: true,
    transports: ['websocket', 'polling']
});
```

### 3. Media Resolution (`utils.js`)
```javascript
resolveUrl: function(url) {
    if (!url) return '';
    if (url.startsWith('/uploads/')) {
        const socketUrl = window.ENV ? window.ENV.SOCKET_URL : '';
        return `${socketUrl}${url}`;
    }
    return url;
}
```

---

## Benefits of Runtime Resolution

1.  **Build Once, Run Anywhere:** A single frontend Docker container or package can be deployed across Local, Dev, Staging, and Production environments without modifying source files or rebundling.
2.  **Zero Build-tool Dependencies:** Eliminates the need for expensive compilation engines, Webpack, Vite, or Gulp, keeping the frontend extremely lightweight and maintaining instant startup speeds.
3.  **Strict Security Boundaries:** Secrets are kept strictly on the backend, and never leaked to `/config.js` or exposed to frontend code.
