# Phase 1 security configuration

Production startup fails closed unless the following are configured:

```dotenv
NODE_ENV=production
SESSION_SECRET=<independent random secret, at least 32 characters>
QDRANT_API_KEY=<independent random Qdrant key, at least 32 characters>
META_APP_SECRET=<Meta application signing secret>
META_VERIFY_TOKEN=<random Meta GET challenge token>
WHATSAPP_APP_SECRET=<WhatsApp signing secret, when separate>
```

Never reuse values and never commit real secrets.

Only for the first start, while the administrators table is empty:

```dotenv
ADMIN_BOOTSTRAP_USERNAME=<unique administrator username>
ADMIN_BOOTSTRAP_PASSWORD=<12-128 characters: upper, lower, number, symbol>
ADMIN_BOOTSTRAP_DISPLAY_NAME=<optional display name>
```

The password must not contain the username. The application removes
`ADMIN_BOOTSTRAP_PASSWORD` from its process environment after successful
creation. Remove the bootstrap variables from the deployment secret store
before restarting.

Changing `SESSION_SECRET` invalidates all signed sessions. Rotate it during a
maintenance window and require administrators to sign in again.

Qdrant must also bind to a private interface/network. Startup validates the API
key, while the host firewall or container network must block public access to
port 6333.
