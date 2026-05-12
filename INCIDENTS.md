# Incident Log

Real cases where an agent (Claude Code, Codex, Cursor, etc.) did the wrong thing because it lacked context. Used to:

1. Anchor the v1 product hypothesis (these are the failures ContextTrail should prevent)
2. Source week-5 behavior-parity demos (re-run the incident with a Context Pack, compare)
3. Build the failure-mode taxonomy (alternative-mechanism drift, cross-module contract drift, etc.)

See [ADR-0003](docs/adr/0003-layered-dogfood-strategy.md) for the dogfood strategy this log supports.

---

## Format

```
### N. Short title — repo

- **Task:** What was the agent asked to do?
- **Changed code:** Which files / modules did the agent touch?
- **Broken rule:** What invariant was violated?
- **What the rule should have said:** One sentence, written as a constraint card.
- **Consequence:** What broke, and how was it discovered?
- **Failure-mode tag:** alternative-mechanism-drift | cross-module-contract-drift | scope-creep | ...
- **Discovered:** YYYY-MM-DD
```

---

## Pre-v1 historical incidents (fundops)

> Mine 5–8 of these from memory before week 1 starts. They become the week-5 measurement targets.

### 1. DB-vs-JSON drift — fundops

- **Task:** _(fill in: what feature were you adding when this happened?)_
- **Changed code:** Backend data flow — agent kept a JSON handoff mechanism alongside DB writes
- **Broken rule:** "Database is the single source of truth; no parallel data-passing mechanisms"
- **What the rule should have said:** "All inter-agent data passing goes through the DB. JSON handoffs are forbidden. If a more convenient path appears, do not take it."
- **Consequence:** Backend now has two sources of truth in some flows. Backend rewrite required to collapse the JSON path back into DB-only. Drift discovered weeks after the fact.
- **Failure-mode tag:** alternative-mechanism-contexttrail
- **Discovered:** _(approximate date)_

### 2. Run-pipeline cross-module whack-a-mole — fundops

- **Task:** Run the full pipeline (Screening → Scout → Valve → ...). User asked agent to fix one thing.
- **Changed code:** _(fill in: which module and symbol did the fix touch?)_
- **Broken rule:** Cross-module contracts between Scout outputs and Valve inputs (or between any pair of sequential modules) — agent didn't understand the chain
- **What the rule should have said:** _(needs to be a graph of symbol_note cards on boundary symbols; e.g., "Scout.run_screening: downstream Valve consumer expects fields A, B, C; never drop these")_
- **Consequence:** Fix to one module silently broke the pipeline elsewhere. Whack-a-mole debugging session.
- **Failure-mode tag:** cross-module-contract-contexttrail
- **Discovered:** ongoing pattern, multiple sessions

### 3. _(name the next one)_

_(target: 5–8 total before week 1 starts)_

---

## During-build incidents (ContextTrail, weeks 1–4)

> Every Claude Code mistake during weeks 1–4 of building ContextTrail lands here.
> Without this log, week-5 measurement on ContextTrail has no baseline to compare against.

### _(empty — populate during weeks 1–4)_

---

## Failure-mode taxonomy (emerging)

Patterns observed across incidents. Used to make sure cards target real failure modes, not invented ones.

- **alternative-mechanism-contexttrail** — rule existed, but a more convenient path was taken because the agent didn't retrieve the rule at decision time
- **cross-module-contract-contexttrail** — no single symbol owns the rule; it lives in the join between modules; agent fixes one side without understanding the other
- _(extend as patterns emerge)_
