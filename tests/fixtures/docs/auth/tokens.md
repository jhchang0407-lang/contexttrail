---
scope:
  layer: module
  project: auth
  module: tokens
  files:
    - src/auth/tokens.ts
  symbols:
    - TokenStore.issue
    - TokenStore.revoke
---

# API tokens

`TokenStore.issue` creates a new API token, stores a bcrypt hash of it in the `api_tokens` table, and returns the plaintext exactly once. The plaintext is never stored — a user who loses their token must rotate it.

## Revocation

`TokenStore.revoke` marks the token record as `revoked`. Revocation takes effect immediately on the next request — there is no grace period. Revoked tokens fail validation at the middleware layer before reaching any handler.

## Rotation

Token rotation issues a new token via `TokenStore.issue` and revokes the old one via `TokenStore.revoke` in a single transaction. **Rotation is not idempotent** — calling it twice produces two new tokens and revokes two old ones. Callers must not retry rotation without user confirmation.

## Validation

Tokens are validated by hashing the presented plaintext and comparing it to the stored hash. Invalid tokens return a 401. Revoked tokens also return a 401 with a distinct error code `TOKEN_REVOKED` to distinguish from invalid tokens.
