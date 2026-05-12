# ADR-0018: Review items live on disk and surface through the agent UI

**Status:** Accepted
**Date:** 2026-05-07

Week 6 bootstrap introduces review items such as candidate cards and clarification needs. We want the primary human experience to happen through the MCP-connected agent or harness UI, but we do not want those review items to live only in the cache or database. ContextTrail stores review items as readable local files under `.contexttrail/inbox/`, with the agent UI acting as the main presentation surface. This keeps review items durable across cache or database rebuilds, makes them inspectable outside the UI, and preserves a clear boundary between provisional review state and accepted repo truth in `.contexttrail/cards/`.
