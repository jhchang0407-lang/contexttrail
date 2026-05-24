# ADR-0026: Persistence substrate may use bounded family evidence without imports

**Status:** Accepted
**Date:** 2026-05-15

Persistence substrate files such as schema, database, and persisted record stores may be admitted as code support through bounded family evidence even when the import graph does not connect them directly to the primary implementation owner. We choose this because PRD-0048 showed schema/db misses that import traversal alone cannot recover, while graph-first retrieval or broad generic storage promotion would weaken chunk-first ranking. The boundary is narrow: family evidence can support implied persistence, but first-slate promotion still requires direct file, symbol, schema, database, or storage evidence, and generic storage, passive reports, evals, examples, and unrelated CLI runner state remain excluded.
