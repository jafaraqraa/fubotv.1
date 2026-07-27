# CORS and Cookie Configuration Guide

This document details the cross-origin communication rules, preflight handling, credentials sharing, and secure cookie properties implemented within the FUThing decoupled architecture.

---

## CORS Security Enforcement Model

CORS rules prevent untrusted websites from querying backend resources. By default, browsers block cross-origin requests unless authorized by the target server.

### Wildcard Restriction
We **never** use the wildcard origin (`*`) with credentials. Standard browser security policies reject requests with `credentials: 'include'` when the server responds with `Access-Control-Allow-Origin: *`.

### Dynamic and Explicit Origin Matching
The backend CORS middleware dynamically matches incoming requests against the explicitly trusted `FRONTEND_ORIGIN` environment value or the default local development origin `http://localhost:5173`.

```javascript
app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

    if (origin === allowedOrigin || origin === 'http://localhost:5173') {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
    }

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204); // Handle preflight requests
    }
    next();
});
```

---

## Cookie Security Properties

Cookies are the secure vehicle used to carry server-side session identifiers (`connect.sid`). They must be carefully guarded.

| Property | Value | Purpose |
| :--- | :--- | :--- |
| **HttpOnly** | `true` | Mitigates XSS. Client-side JS cannot extract `connect.sid`. |
| **Secure** | `process.env.NODE_ENV === 'production'` | Mitigates eavesdropping. Cookie transmitted only over SSL (HTTPS). |
| **SameSite** | `process.env.COOKIE_SAMESITE \|\| 'lax'` | Mitigates CSRF. `'lax'` is recommended for subdomain/same-site setups. |
| **Domain** | `process.env.COOKIE_DOMAIN` | Enables cross-subdomain sessions (e.g., sharing across `api.` and `dashboard.`). |
| **MaxAge** | `28800000` | Limits session lifespan to 8 hours. |

---

## Troubleshooting Local Development Cookie Issues

During local development, Chrome and major browsers permit cookie sharing across different localhost ports (such as `http://localhost:5173` and `http://localhost:3005`) under the following conditions:

1.  **SameSite must be `lax` or `none`:** Set `COOKIE_SAMESITE=lax` in `backend/.env`.
2.  **No `Secure` on HTTP:** Ensure `NODE_ENV=development` so that `secure` cookie property is evaluated to `false`. Browsers reject cookies with `Secure: true` over unencrypted HTTP.
3.  **Enable Credentials on Client:** Ensure `credentials: "include"` is set in both the fetch client and the Socket.IO setup.
