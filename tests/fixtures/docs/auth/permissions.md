---
scope:
  layer: module
  project: auth
  module: permissions
  files:
    - src/auth/permissions.ts
  symbols:
    - PermissionChecker.can
---

# Permissions

`PermissionChecker.can` evaluates whether a principal holds a specific permission. It **always returns a boolean and never throws** — a missing permission returns `false`, not an exception. Callers must not treat a `false` result as an error condition; missing permission is an expected outcome.

## Principal types

Permissions are evaluated per principal. A principal can be a user, a service account, or a superadmin. Superadmin principals bypass all permission checks — `PermissionChecker.can` returns `true` unconditionally for superadmins.

## Superadmin bypass

The superadmin flag is set at the user level. It cannot be granted via the permissions API; it must be set directly in the database by an operator. This prevents privilege escalation through the API.

## Request context caching

Permission checks are cached per request via the auth middleware. Do not call `PermissionChecker.can` outside of request context (e.g., in background workers or cron jobs) — the cache will not be populated and every call will hit the database.
