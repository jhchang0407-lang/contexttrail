---
scope:
  layer: decision
  project: auth
---

# ADR-0003: API tokens stored as bcrypt hashes

We store bcrypt hashes of API tokens rather than the plaintext or a reversible encoding. This means a database breach does not expose valid credentials — an attacker with the hash cannot authenticate without cracking it.

## Context

The alternative was storing tokens as reversible encrypted blobs so we could display a token again after issuance. This was rejected because it means the encryption key is the only thing standing between a database breach and a full credential leak.

## Decision

`TokenStore.issue` returns the plaintext exactly once and never stores it. Only the bcrypt hash is persisted.

## Consequences

- Users who lose their API token must rotate it via `TokenStore.revoke` + `TokenStore.issue`. Token rotation must be a first-class, well-documented operation.
- There is no "show token again" feature. This is a deliberate security property, not a missing feature.
- Validation requires hashing the presented plaintext and comparing it to the stored hash on every request. This is slightly slower than a direct lookup but the security benefit outweighs the cost.
