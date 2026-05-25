# Unseen Business Ops Expansion

Date: 2026-05-25

## Goal

Expand the document-workflow eval before further engine tuning, so the latest source-local and near-miss improvements are tested against fresh documents and tasks rather than only the development suite.

## Added Packet

Fixture: `tests/fixtures/document-workflows/business-ops-expansion/workflows.yaml`

New corpus:

- 27 Markdown sources.
- 12 workflows.
- 96 fields.
- 37 required slots.
- 90 evidence requirements.
- 21 searched-scope requirements.

The packet covers six office-work archetypes:

- banking credit exception review
- support/service-credit evidence review
- contract and policy obligation review
- AP and close reconciliation
- customer relationship history synthesis
- HR lifecycle operations
- vendor onboarding and bank-change compliance

The packet includes stale loan files, template/legal decoys, prior invoice decoys, similar-name vendor decoys, missing evidence, conflicting numeric rows, and non-authoritative searched-scope proofs.

## Important Constraint

The engine was not tuned against this new packet. This was an expansion/generalization check after commit `2ee86e3`.

## New Packet Result

`business_ops_expansion_workflows`:

- Required slots: `36/37`
- Slot evidence: `90/90`
- Section recall: `90/90`
- Searched scope: `20/21`
- Decoys retrieved: `7`

Only miss:

- `contractor_conversion_readiness / benefits_packet_missing`
- Cause: right source, wrong section
- The slot selected `conversion-policy.md > Benefits Timing` and `Eligibility`, but missed `Signed Forms`, which states the benefits election packet must be signed before start.

## Expanded Panel Result

The active document workflow panel now has:

- 7 fixture packets
- 42 workflows
- 91 imported sources
- 304 fields
- 144 slots

Expanded normal panel:

- Required slots: `138/143`
- Slot evidence: `286/289`
- Section recall: `289/289`
- Searched scope: `64/66`
- Decoys retrieved: `37`
- Over-budget slots: `0`

Expanded reference-output panel:

- Field accuracy: `260/260`
- Citation validity: `260/260`
- Citation authority: `303/304`
- Abstention: `43/44`
- Explanation: `43/44`
- Decoy authority misuse: `0`
- Decoy authority citations: `0`
- Rejected decoy citations: `9`

## Mutation Result

Broad task queries:

- Required slots: `133/143`
- Searched scope: `62/66`
- Section recall: `279/289`
- Decoys: `34`
- New expansion packet alone: `37/37` required, `90/90` evidence, `21/21` searched scope

Minimal task queries:

- Required slots: `108/143`
- Searched scope: `56/66`
- Section recall: `242/289`
- Decoys: `28`
- New expansion packet alone: `28/37` required, `79/90` evidence, `18/21` searched scope

Corpus noise:

- Required slots: `138/143`
- Searched scope: `64/66`
- Section recall: `289/289`
- Decoys: `34`
- New expansion packet alone: `36/37` required, `90/90` evidence, `20/21` searched scope

## Read

This expansion reduces the overfitting concern but does not eliminate it. The engine generalized better than expected on the new authored packet: perfect evidence-section recall and only one searched-scope miss. The weak point remains query compression: minimal task queries cause a much larger drop, especially in the new packet.

The next engine fix should stay generic:

- section-neighborhood completion for adjacent rule/checklist sections in the same source
- a separate excluded-authority evidence lane for non-binding template proof
- slot-local copy of exact evidence already retrieved elsewhere in the workflow

Do not tune directly against the new packet until it has served as an unseen check for at least one more method round.
