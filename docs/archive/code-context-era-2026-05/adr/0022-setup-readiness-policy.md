# ADR-0022: Setup readiness band policy

**Status:** Accepted
**Date:** 2026-05-11

> Governs: [PRD-0033](../prd/0033-setup-readiness-scan-and-confidence-report.md). Related: [ADR-0001](0001-wizard-a-deterministic-setup-only.md), [ADR-0014](0014-agent-assisted-setup-without-truth-promotion.md), [ADR-0015](0015-task-readiness-gates-authority-not-access.md), [ADR-0021](0021-gate-calibration-policy.md) (sibling band-policy convention).

## Context

PRD-0033 ships `contexttrail setup` — a deterministic repo-level readiness scan with four named dimensions (`corpus_coverage`, `scope_coverage`, `card_coverage`, `retrieval_probes`). Each dimension reports a band in `{ low | partial | confident }` plus structured evidence and a single deterministic next-step suggestion.

The band thresholds are initial estimates derived from inspection of ContextTrail's own corpus state and PRD-0009's bootstrap evidence — not from a panel of real pilot repos. ADR-0021 already established the policy convention for similar locked thresholds (`ASSEMBLY_GATE_BANDS` in `src/eval/assembly-gate-bands.ts`). This ADR mirrors that convention for setup readiness so the same accountability applies: thresholds live in code, future changes require an ADR amendment in the same commit, and the band table is locked verbatim against this ADR until amended.

The risk this ADR addresses is named in PRD-0033 directly:

> Bands may be miscalibrated against real repos. The thresholds (`<30%`, `<50%`, etc.) are chosen from inspection of ContextTrail's own corpus state and PRD-0009's bootstrap evidence — not from a panel of real repos. Mitigation: bands live in `src/setup/readiness-bands.ts` as a frozen constant per the ADR-0021 convention; first pilot use surfaces miscalibration as named feedback for an amendment.

Without an explicit policy, a future PRD that adjusts a threshold could ship as a one-line edit to `readiness-bands.ts` with no visibility into *why*. That is the same drift risk ADR-0021 closed for assembly gates.

## Decision

Three rules, locked.

### Rule 1 — Four named dimensions, locked thresholds

The setup readiness scan reports exactly four dimensions, with the following band thresholds (mirrored verbatim from PRD-0033's "Solution → Four readiness dimensions" table):

| dimension | what it measures | low | partial | confident |
|---|---|---|---|---|
| `corpus_coverage` | imported markdown vs corpus-shape (markdown count under `docs/` + repo-root README) | <30% of discoverable markdown imported | 30–70% | ≥70% |
| `scope_coverage` | fraction of imported chunks with non-`unknown` scope layer | <50% | 50–80% | ≥80% |
| `card_coverage` | accepted cards present + scope distribution | 0 accepted cards | 1–5 cards OR no `constraint` cards | ≥6 cards including ≥1 `constraint` |
| `retrieval_probes` | built-in probe set against the local corpus; measures `coverage_confidence` distribution from `retrieve_context_pack` | <50% of probes return `confident` | 50–80% | ≥80% |

Each threshold pair (`low_max`, `partial_max`) is locked in `SETUP_READINESS_BANDS` (`src/setup/readiness-bands.ts`). Dimensions are not added or removed without an ADR-0022 amendment.

### Rule 2 — Absolute-count floor on corpus coverage

The `corpus_coverage` band additionally enforces an absolute-count floor: a repo with `< 5 imported chunks` always reports `low`, regardless of the imported/discoverable fraction. This prevents the trivial-confident state PRD-0033's Risks section names ("over-recommend if e.g. corpus_coverage: confident is satisfied trivially on a repo that only has one README").

The floor is encoded as `SETUP_READINESS_BANDS.corpus_coverage.minimum_chunk_floor = 5`. The other three dimensions have no analogous absolute floor today; if a future amendment introduces one, it ships with this ADR.

### Rule 3 — Threshold changes require ADR-0022 amendment, same commit

Locked thresholds live in code (`src/setup/readiness-bands.ts`) and are version-controlled. Changing any threshold — `low_max`, `partial_max`, `minimum_chunk_floor`, `partial_max_cards`, `confident_min_cards`, the `≥1 constraint` rule, or the four-dimension list itself — requires an amendment to this ADR in the same commit as the code change.

This is the exact convention ADR-0021 Rule 3 established for assembly gates. The rationale carries over: a threshold that auto-tunes is a threshold that ratchets quietly. Making it a code constant means *someone has to write a commit message saying why it moved* — the same accountability we apply to ADR amendments. The same rule applies to:

- The probe set in `src/setup/probes.ts` (six probes today; expansion or replacement is an amendment).
- The next-step decision table in `src/setup/next-step.ts` (≤12 rows; row additions or reorderings are amendments).

The amendment lives in this ADR as a new "### Amendments" subsection, not as a separate ADR per change.

## Why structural, not data-fitting

| concern | mitigation |
|---|---|
| Aren't these thresholds going to need tuning on real pilot repos? | Yes — PRD-0033 says so explicitly in Risks. The first pilot run that surfaces a miscalibration produces named feedback; the amendment path documented in Rule 3 is the explicit update mechanism. |
| Why one ADR per band-policy rather than per-PRD? | ADR-0021 already proved the convention. Two PRDs that touch setup readiness (PRD-0033 today, future LLM-assisted clarification PRD) can both reference this single ADR rather than fragmenting the policy across multiple docs. |
| Why include the next-step table and probe set in the same ADR? | They are the same load-bearing surface as the bands themselves. A "small" tweak that adds a 13th row to the next-step table, or swaps a probe for a corpus-specific one, would silently change behavior for every pilot user. Bundling them under one amendment process makes the change visible. |
| Why ≤12 rows for the next-step table? | The PRD says so. The cap is a structural assertion: beyond 12 rows, the table is no longer a "printed mapping" — it has become a heuristic engine, and that's a different kind of decision that this ADR explicitly is *not* making. A breach of the cap is a re-shaping moment, not an ad-hoc extension. |

## Consequences

- `SETUP_READINESS_BANDS`, `SETUP_PROBES`, and `NEXT_STEP_TABLE` are `Object.freeze`d in their respective modules. Runtime mutation is impossible by construction.
- A `next-step.test.ts` row-count cap test fails if `NEXT_STEP_TABLE.length > 12` without an ADR amendment.
- Future PRDs that change any locked surface must include the ADR-0022 amendment in the same commit. Reviewers should reject diffs that touch `src/setup/readiness-bands.ts` (or peer files) without a matching ADR update.
- The CLI / MCP surfaces (`contexttrail setup`, `get_setup_readiness`) are renderings of these locked structures. Renderer changes are not policy changes and do not require an ADR amendment.

## Amendments

*(none yet — initial commit)*
