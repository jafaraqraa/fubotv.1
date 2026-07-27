# DASHBOARD & API AUTHENTICATION DOCUMENTATION

This document defines the server-side authentication architecture, session management policies, and rate-limiting configurations implemented to protect the dashboard interface and administrative API endpoints.

---

## 1. Authentication Architecture
We implemented a secure **Server-Side Session-Based Authentication** model rather than client-side JWT tokens in localStorage.
* **Why server-side sessions?** Storing secrets or JWT tokens in browser localStorage leaves them highly vulnerable to Cross-Site Scripting (XSS) attacks. Standard sessions kept in an HTTP-only, secure, SameSite=Lax cookie are natively protected by the browser from malicious JS scripts, reducing frontend attack vectors.

---

## 2. Predefined Administrator Account
An administrator account is automatically bootstrapped during database initialization if no account exists, ensuring an immediate out-of-the-box secure local login experience.
* **Initial Username:** `admin`
* **Predefined Default Password:** `Admin@123456`
* **Hashing Strategy:** Password hashes are computed using `bcryptjs` with a cost factor of `10`. Plain-text credentials are never written to SQLite or printed in logs.
* **Security Recommendation:** It is critical to change the default password after your first successful login.

---

## 3. SQLite Session Store
User sessions are persisted inside a robust SQLite `sessions` table, meaning active session cookies survive backend restarts.
* **Session Lifetime:** 8 hours (`28,800,000` ms).
* **Cookie Parameters:**
  * `httpOnly: true` (Prevents client-side script reads).
  * `sameSite: 'lax'` (Provides CSRF mitigation).
  * `secure: true` (Enforced automatically under production HTTPS environments).

---

## 4. Administrative API Protection
* Every administrative route under `/api/*` (excluding login/logout and webhook listeners) is protected by the `requireAuth` middleware.
* Unauthenticated requests are rejected immediately with `401 Unauthorized` JSON objects:
  `{ "success": false, "error": "Authentication required" }`
* Static served pages (specifically `/dashboard.html`) redirect unauthenticated requests to `/login`.

---

## 5. Public Routes & Webhooks
The Meta webhook paths `GET /webhook` and `POST /webhook` remain publicly accessible, ensuring Meta developers' subscripton callbacks continue delivering incoming WhatsApp, Messenger, and Instagram messages without session blocks.

---

## 6. Login Rate Limiting
* **Failed Attempt Limit:** Max 5 failed login attempts per 15 minutes per IP address.
* **Exceeded Response:** Returns status `429 Too Many Requests` with a descriptive message.
* **Scope:** Only applies to `/api/auth/login`, ensuring webhooks or administrative stats aren't impacted.

---

## 7. Basic Security Headers
The Express app automatically injects standard HTTP security headers:
* `X-Content-Type-Options: nosniff` (MIME sniffing mitigation).
* `X-Frame-Options: SAMEORIGIN` (Clickjacking mitigation).
* `Referrer-Policy: no-referrer-when-downgrade` (Avoids referrer leakages).
* `X-XSS-Protection: 1; mode=block` (Cross-Site Scripting filter).
These settings prevent visual regressions or blocking of Tailwind CSS CDN, Chart.js resources, and Cairo fonts.

---

## 8. Password Change Strength Policy
Administrators can securely change their password through `POST /api/auth/change-password` which enforces:
1. Current password matching.
2. New password must be different from current password.
3. Minimum length of 10 characters.
4. Inclusion of at least one uppercase letter, one lowercase letter, one number, and one special character (e.g., `!@#$%^&*`).
5. Securely writes the new bcrypt hash to SQLite.
