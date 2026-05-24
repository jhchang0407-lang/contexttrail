# ContextTrail MVP Spec — Revised

## One-Line Definition

ContextTrail is a local-first integrity layer for AI-assisted software development.

It detects meaningful code changes, checks whether those changes are covered by known intent and evidence, and reports where confidence has drifted.

---

## Core Promise

> When code changes, ContextTrail tells you which behavior surfaces changed, whether those surfaces are covered by requirements or evidence, and what needs attention.

---

## Core Loop

```text
git diff
  → semantic change surfaces
  → coverage check
  → requirement/evidence impact
  → actionable report
```

---

## Important Design Correction

The MVP should not begin with tests, LLM-generated requirements, or a full requirement graph.

The MVP begins with:

> meaningful code change detection + coverage/noise control

Then it layers on requirements and evidence.

---

# 1. V1 User

The v1 user is:

```text
1 human developer + N AI coding agents
```

Assumptions:

- Small or solo codebase
- Fast-changing code
- Medium discipline
- Incomplete tests
- Incomplete specs
- Heavy AI-generated changes

This is not an enterprise compliance tool in v1.

---

# 2. V1 Non-Goals

Do not build these in v1:

- Enterprise dashboard
- Permissions
- Audit trails
- Full semantic graph
- Full cross-language code intelligence
- LLM-generated requirements as authoritative system state
- LLM rationale as evidence
- Automatic proof of consistency
- Complete test-to-symbol inference

---

# 3. Key Product Question

ContextTrail is not trying to answer:

```text
Is the whole system correct?
```

It is trying to answer:

```text
What meaningful behavior changed, and is that change covered by known intent or evidence?
```

---

# 4. What ContextTrail Gives Over CI

CI asks:

```text
Did the test suite pass?
```

ContextTrail asks:

```text
What meaningful behavior changed?
Is the changed surface covered by a requirement?
Is there evidence for that requirement?
Should evidence be rerun?
Is this change occurring in an untracked surface?
```

CI gives pass/fail.

ContextTrail gives change-to-intent visibility.

---

# 5. Revised MVP Architecture

## Signal 1: Semantic Change Surfaces

Detect meaningful changes at the symbol or module boundary.

Examples:

- Function body changed
- Function signature changed
- Public type/interface changed
- API route handler changed
- Database migration changed
- Config affecting runtime changed
- Call structure changed
- Branch/control-flow shape changed

## Signal 2: Coverage State

For each changed surface, determine whether it is:

```text
covered_by_requirement
covered_by_evidence
tracked_but_no_evidence
untracked
ignored
out_of_scope
```

## Signal 3: Drift State

For tracked surfaces:

```text
meaningful change + linked requirement + stale evidence
→ requirement becomes unknown

meaningful change + linked requirement + failing evidence
→ proven_inconsistent

meaningful change + linked requirement + passing evidence
→ proven_consistent

meaningful change + no requirement/evidence
→ uncovered semantic change
```

---

# 6. Status Model

Keep status simple in v1.

```text
proven_consistent
unknown
proven_inconsistent
```

Do not add `likely_consistent` yet.

Reason:

- Weak evidence is easy to misuse.
- LLM rationale should not elevate state.
- Simpler states make the system harder to fool.

---

# 7. Evidence Rules

Valid state-changing evidence:

```text
test
static_check
runtime_trace
contract_check
```

Invalid as state-changing evidence:

```text
LLM rationale
LLM explanation
LLM-generated confidence
LLM-generated requirement text
```

LLMs may suggest:

- possible links
- possible evidence commands
- possible requirement wording
- possible areas of concern

But LLM output does not change truth state.

---

# 8. Requirement Rules

Requirements must be user-authored or user-confirmed.

LLMs may draft candidate requirements, but candidates remain non-authoritative until accepted.

V1 should not depend on AI-generated requirements.

Required states for requirement atoms:

```text
candidate
accepted
archived
```

Only `accepted` requirements participate in drift status.

---

# 9. The Hard Part: Semantic Change Detection

## Honest Constraint

AST fingerprinting is not easy.

The MVP cannot assume that simply using tree-sitter, Python `ast`, or ts-morph solves semantic change detection.

Hard cases include:

- name resolution
- overloaded imports
- cross-file symbol resolution
- decorators
- closures
- generated code
- dynamic Python dispatch
- generic or templated TypeScript
- type-only changes
- runtime-equivalent refactors
- aliasing
- dependency injection
- framework magic

Therefore, the MVP should not promise perfect semantic understanding.

It should implement a conservative, scoped semantic change detector.

---

# 10. Semantic Change Detector Scope

## V1 Supported Languages

Pick one primary language first.

Recommended:

```text
TypeScript first
Python second
```

Reason:

- TypeScript has better tooling for project-level symbol information.
- ts-morph / TypeScript compiler API can provide more reliable symbol and type information than raw syntax parsing.
- Python is more dynamic and harder to resolve accurately.

## V1 TypeScript Implementation

Use:

```text
TypeScript compiler API
ts-morph
```

Detect:

- changed function declarations
- changed method declarations
- changed exported symbols
- changed interfaces/types
- changed imports
- changed call expressions inside tracked symbols
- changed return statements
- changed branch structure
- changed API route handlers if framework conventions are configured

## V1 Python Implementation

Use Python `ast` only for local structural fingerprints.

Do not pretend to resolve cross-file behavior accurately in v1.

Detect:

- changed function definitions
- changed class methods
- changed imports
- changed return structure
- changed branch structure
- changed function calls by local textual name

Python support should be marked experimental until better resolution exists.

---

# 11. Fingerprints

For each tracked symbol, compute multiple fingerprints.

```text
signature_fingerprint
export_surface_fingerprint
control_flow_fingerprint
call_shape_fingerprint
return_shape_fingerprint
literal_shape_fingerprint
import_dependency_fingerprint
```

These are not proofs of semantic equivalence.

They are change classifiers.

## SAFE Change

No relevant fingerprints changed.

Examples:

- formatting
- comments
- whitespace
- non-semantic ordering changes

## LOW Change

Minor internal changes that do not alter public surface, control flow, call shape, or return shape.

Examples:

- local variable rename
- equivalent expression rewrite
- type annotation only, when configured as non-runtime

## MEANINGFUL Change

At least one important fingerprint changed.

Examples:

- signature changed
- exported type changed
- branch structure changed
- return shape changed
- called dependency changed
- runtime import changed
- route handler changed
- database migration changed

## HIGH-RISK Change

Changes likely to affect many downstream surfaces.

Examples:

- public API signature changed
- shared type/interface changed
- migration changed
- auth/payment/security code changed
- central service method changed
- config affecting runtime behavior changed

---

# 12. Noise Control Is Mandatory

Without noise control, `uncovered semantic change` becomes alert spam.

Most code in a real codebase will initially be untracked.

Therefore, v1 must include noise-control mechanisms before shipping.

---

## 12.1 Project Scope

ContextTrail only analyzes configured paths.

Example:

```json
{
  "include": [
    "src/core/**",
    "src/orders/**",
    "src/payments/**"
  ],
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "scripts/**",
    "generated/**",
    "node_modules/**",
    "dist/**"
  ]
}
```

Default behavior:

- Include only application source directories.
- Exclude tests, generated files, scripts, build artifacts, vendored code.
- Require explicit opt-in for broad scanning.

---

## 12.2 Watchlist

V1 should support a watchlist.

```json
{
  "watchlist": [
    "src/orders/**",
    "src/payments/**",
    "src/auth/**"
  ]
}
```

Uncovered semantic changes outside the watchlist are summarized, not alerted.

Example:

```text
3 meaningful changes outside watchlist hidden. Run `drift analyze --all` to view.
```

---

## 12.3 Ignore Rules

Support persistent ignores.

```bash
drift ignore path scripts/**
drift ignore symbol src/debug/devTools.ts::seedTestUser
drift ignore change CHG-abc123
```

Stored in config:

```json
{
  "ignored_paths": [],
  "ignored_symbols": [],
  "ignored_change_patterns": []
}
```

---

## 12.4 Alert Budget

Limit high-attention alerts.

Default:

```text
max_high_attention_alerts = 5
```

If more than 5 uncovered changes are detected:

```text
Show top 5 by risk.
Summarize the rest.
```

Example:

```text
High-attention alerts:
1. PaymentService.capturePayment — public method changed
2. AuthMiddleware.verifySession — branch structure changed

Additional uncovered changes:
7 hidden lower-priority changes
```

---

## 12.5 Risk Thresholds

Only alert uncovered semantic changes if they exceed a configured risk threshold.

Risk score inputs:

```text
change_kind
symbol_exported
path_importance
file_centrality
manual critical path match
diff_size
dependency fanout, if available
```

Example:

```text
risk >= 0.7 → high attention
risk >= 0.4 → report only
risk < 0.4 → ignore unless --all
```

---

## 12.6 Dormant Code Rule

Untracked dormant code is not constantly reported.

It is reported only when:

```text
it changes meaningfully
AND it is inside configured scope
AND risk exceeds threshold
```

---

# 13. Link Quality Strategy

Link quality remains hard.

V1 should not pretend to solve traceability.

Instead, it should make link uncertainty explicit and reduce reliance on links for day-one value.

## Link Types

```text
manual
user_confirmed
test_direct
test_indirect
llm_suggested
git_cochange
```

## Link Weights

```text
manual: 0.95
user_confirmed: 0.95
test_direct: 0.7–0.85
test_indirect: 0.3–0.6
llm_suggested: 0.2–0.5
git_cochange: 0.2–0.5
```

## Trigger Rules

Only these can trigger high-confidence requirement contexttrail:

```text
manual
user_confirmed
test_direct
```

Weak links can produce suggestions, not hard state transitions.

---

# 14. Test-Derived Links

Tests are useful but noisy.

Test-derived linking should be conservative.

## Strong Test Signals

Accept:

- direct function call
- method call on constructed object
- explicit spy/mock target
- API route invocation, if route map is known
- assertion involving returned value from direct call

## Weak or Ignored Test Signals

Do not strongly link from:

- import only
- fixture only
- helper only
- factory only
- broad service import
- mock setup without invocation
- indirect integration test without known route map

## Test Link Categories

```text
direct_test_link
integration_surface_link
inferred_downstream_link
```

Only `direct_test_link` can become high-confidence automatically.

---

# 15. Git Co-Change

Git co-change is noisy.

Use it only as a weak signal.

Good for:

- suggesting possible links
- ranking review candidates
- detecting repeated historical coupling

Bad for:

- authoritative link creation
- hard drift state changes
- proof of requirement impact

---

# 16. LLM Usage

LLMs are assistants, not judges.

They may:

- suggest links
- explain why a change may matter
- draft requirement candidates
- suggest evidence commands
- summarize drift reports

They may not:

- mark a requirement consistent
- mark a requirement inconsistent
- create authoritative requirements without user confirmation
- create state-changing evidence
- override deterministic checks

---

# 17. Data Model

Use SQLite.

## requirements

```sql
CREATE TABLE requirements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  requirement_state TEXT NOT NULL DEFAULT 'candidate',
  drift_status TEXT NOT NULL DEFAULT 'unknown',
  critical BOOLEAN DEFAULT FALSE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Allowed `requirement_state`:

```text
candidate
accepted
archived
```

Allowed `drift_status`:

```text
proven_consistent
unknown
proven_inconsistent
```

---

## symbols

```sql
CREATE TABLE symbols (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  symbol_name TEXT NOT NULL,
  symbol_type TEXT,
  exported BOOLEAN DEFAULT FALSE,
  start_line INTEGER,
  end_line INTEGER,
  last_fingerprint TEXT,
  updated_at TEXT NOT NULL
);
```

---

## symbol_fingerprints

```sql
CREATE TABLE symbol_fingerprints (
  symbol_id TEXT PRIMARY KEY,
  signature_fingerprint TEXT,
  export_surface_fingerprint TEXT,
  control_flow_fingerprint TEXT,
  call_shape_fingerprint TEXT,
  return_shape_fingerprint TEXT,
  literal_shape_fingerprint TEXT,
  import_dependency_fingerprint TEXT,
  computed_at TEXT NOT NULL
);
```

---

## requirement_links

```sql
CREATE TABLE requirement_links (
  requirement_id TEXT NOT NULL,
  symbol_id TEXT NOT NULL,
  weight REAL NOT NULL,
  source TEXT NOT NULL,
  confirmed BOOLEAN DEFAULT FALSE,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (requirement_id, symbol_id)
);
```

---

## evidence

```sql
CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  requirement_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  command TEXT NOT NULL,
  last_status TEXT,
  last_run_at TEXT,
  last_passed_at TEXT
);
```

---

## change_events

```sql
CREATE TABLE change_events (
  id TEXT PRIMARY KEY,
  git_sha TEXT,
  diff_summary TEXT,
  created_at TEXT NOT NULL
);
```

---

## semantic_changes

```sql
CREATE TABLE semantic_changes (
  id TEXT PRIMARY KEY,
  change_event_id TEXT NOT NULL,
  symbol_id TEXT,
  file_path TEXT NOT NULL,
  change_kind TEXT NOT NULL,
  risk_score REAL NOT NULL,
  is_uncovered BOOLEAN DEFAULT FALSE,
  is_ignored BOOLEAN DEFAULT FALSE,
  created_at TEXT NOT NULL
);
```

---

## impact_events

```sql
CREATE TABLE impact_events (
  id TEXT PRIMARY KEY,
  change_event_id TEXT NOT NULL,
  requirement_id TEXT NOT NULL,
  semantic_change_id TEXT,
  impact_score REAL NOT NULL,
  impact_level TEXT NOT NULL,
  reason TEXT,
  user_decision TEXT,
  created_at TEXT NOT NULL
);
```

---

# 18. CLI Surface

## Initialize

```bash
contexttrail init
```

Creates:

```text
.contexttrail/
  contexttrail.db
  config.json
```

---

## Configure Scope

```bash
contexttrail scope add src/orders/**
contexttrail scope add src/payments/**
contexttrail scope ignore generated/**
```

---

## Index

```bash
contexttrail index
```

Parses configured source files and stores symbols/fingerprints.

---

## Analyze Diff

```bash
drift analyze
```

Output begins with semantic changes, not requirements.

Example:

```text
Semantic changes detected:

1. src/payments/refund.ts::RefundService.processRefund
   Change: control_flow_changed, call_shape_changed
   Risk: high

   Requirement coverage:
   - R17 Canceling paid order triggers refund
     status: unknown
     reason: linked evidence stale

   Evidence:
   - refund-cancel.test.ts available

2. src/orders/archive.ts::OrderService.archive
   Change: return_shape_changed
   Risk: medium

   Coverage:
   - no accepted requirement
   - no evidence

   Alert:
   uncovered semantic change
```

---

## Add Requirement

```bash
drift req add R17 \
  --title "Canceling paid order triggers refund" \
  --body "When a paid order is canceled, the system must create a refund."
```

New requirements start as `candidate`.

---

## Accept Requirement

```bash
drift req accept R17
```

Only accepted requirements participate in drift state.

---

## Link Requirement

```bash
drift link R17 src/payments/refund.ts::RefundService.processRefund --weight 0.95 --source manual
```

---

## Add Evidence

```bash
drift evidence add R17 \
  --type test \
  --command "npm test -- refund-cancel.test.ts"
```

---

## Run Evidence

```bash
drift evidence run R17
drift evidence run --affected
```

---

## Confirm or Dismiss Medium Impact

```bash
drift confirm R31
drift dismiss R31
```

Confirmation increases link weight.

Dismissal decreases link weight.

---

## Ignore Noise

```bash
drift ignore path scripts/**
drift ignore symbol src/devtools.ts::seedData
drift ignore change CHG-abc123
```

---

## Status

```bash
drift status
```

Example:

```text
Requirements:
- proven_consistent: 12
- unknown: 3
- proven_inconsistent: 1

Semantic changes:
- high-risk uncovered: 2
- medium-risk uncovered: 4
- hidden by scope/noise rules: 9
```

---

# 19. Revised Build Plan

## Phase 1: Scope + Diff + Structural Change Detection

Estimated time:

```text
1–2 weeks
```

Build:

- config scope
- git diff reader
- TypeScript symbol extraction
- TypeScript fingerprinting
- semantic change classification
- safe/meaningful/high-risk distinction
- noise controls

Success criterion:

```text
Can distinguish formatting/comment changes from meaningful behavior-surface changes on the target codebase.
```

This phase has landmines and should not be underestimated.

---

## Phase 2: Coverage Graph

Estimated time:

```text
1 week
```

Build:

- accepted requirements
- manual links
- evidence commands
- requirement drift state
- uncovered semantic change alerts

Success criterion:

```text
Meaningful change to linked symbol marks requirement unknown.
Meaningful change to unlinked high-risk symbol reports uncovered semantic change.
```

---

## Phase 3: Link Suggestions

Estimated time:

```text
1 week
```

Build optional weak suggestions from:

- direct test calls
- LLM suggestions
- git co-change

Success criterion:

```text
Suggestions reduce manual linking effort without creating high-confidence false positives.
```

---

# 20. Falsification Criteria

Continue only if, after dogfooding:

```text
- It catches at least 3 issues or coverage gaps you act on.
- High-attention false positives stay under 20%.
- You do not ignore the tool for 3 consecutive working days.
- Setup takes less than 30 minutes for a useful scoped area.
- Scope/noise controls prevent alert spam.
```

Kill or redesign if:

```text
- Most alerts are obvious or irrelevant.
- Uncovered semantic change becomes noise.
- AST change classification is too inaccurate.
- Manual linking feels worse than writing tests.
- You stop checking the report.
```

---

# 21. MVP Positioning

Do not pitch v1 as:

```text
AI-generated requirements
automatic spec-code correctness
replacement for CI
perfect semantic drift detection
```

Pitch v1 as:

```text
A local integrity layer that detects meaningful code changes and shows whether those changes are covered by known intent and evidence.
```

---

# 22. Final MVP Wedge

The first useful behavior is:

```text
You changed this behavior surface.
It is high-risk.
It has no accepted requirement.
It has no evidence.
This is an uncovered semantic change.
```

The second useful behavior is:

```text
You changed this behavior surface.
It is linked to R17.
R17's evidence is now stale.
Run this evidence command to restore confidence.
```

That is enough for v1.

---

# 23. Core Insight

> ContextTrail does not prove software correctness.
> It maintains an explicit integrity ledger between code changes, accepted intent, and evidence.

The system is valuable because it refuses to silently assume that changed behavior is still aligned with intent.
