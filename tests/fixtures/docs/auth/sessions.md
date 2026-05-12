---
scope:
  layer: module
  project: auth
  module: sessions
---

# Session management

Sessions are stored in Redis with a 24-hour TTL. The `SessionStore.get` method returns null for expired sessions; do not treat absence as an error. See `src/auth/session.ts`.

## Renewal

A session is renewed by calling `POST /sessions/:id/renew`. Renewal extends the TTL but does not rotate the session token.
