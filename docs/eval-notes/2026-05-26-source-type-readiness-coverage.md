# 2026-05-26 Source-Type Readiness Coverage

## Change

Promoted one adequate-search signal from eval gold into a production-observable
input.

Slots can now declare expected source types through filters such as
`expected_source_types`, `source_type`, or `document_type`. Retrieved sections
can carry `source_type`, and the robust eval runner hydrates it from Markdown
frontmatter when present.

This lets the readiness layer distinguish:

- missing evidence after searching all expected source types
- missing evidence after searching only some expected source types

## Behavior

For missing-context slots:

- expected source types all searched -> `adequate`, `ready`, valid missing
  context finding
- expected source types partially searched -> `partial`, `retry_required`
- expected source types not searched -> `insufficient`, `retry_required`

The previous searched-scope gold path still works, but source-type coverage is
the first non-gold adequate-search path.

## Robust Result

Latest robust trace stayed stable:

- Slot evidence recall: `470/473` (`99.4%`)
- Required slots satisfied: `176/181` (`97.2%`)
- Searched-scope coverage: `86/88` (`97.7%`)
- Pack readiness: `ready=50`, `retry_required=5`, `partial=0`, `blocked=0`
- Required slot readiness: `ready=176`, `retry_required=5`, `partial=0`,
  `blocked=0`
- Known required-slot misses flagged: `5/5`
- False retry on satisfied required slots: `0/176`
- Critical false missing-context claims: `0`

## Read

This is a foundation pass, not a headline metric improvement. The current robust
fixtures do not yet use expected source-type filters broadly, so the aggregate
numbers are intentionally unchanged.

The important improvement is observability quality: future slots can now explain
that a pack is not ready because the engine searched `employee_record` but not
`signed_forms_packet`, instead of relying only on gold searched-scope accounting.
