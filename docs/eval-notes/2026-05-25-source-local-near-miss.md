# Source-Local and Near-Miss Assembly

Date: 2026-05-25

## Goal

Fix the remaining generic misses where the engine had either found the right source but not the exact section, or had a useful candidate just below the selected cutoff. The change should improve context assembly without making the engine more domain-specific.

## Method Kept

- Added source-local completion: after normal retrieval, add one high-fit nearby section from sources already selected in the slot.
- Added near-miss promotion: allow one rejected candidate back into the slot when it has strong field/heading fit and is not stale or non-authoritative.
- Strengthened expected-place search for missing checks: reserve room for a strong outside-source participant/stakeholder absence section.
- Added non-authoritative template penalties for sections that say they are template guidance, not automatically part of a signed agreement, non-binding, or reference-only.
- Added empty-section guards so supplement layers do not promote title-only document roots.

## Tuning Notes

- The first near-miss version fixed the employee remote-work miss but raised normal decoys from 30 to 31 by admitting a stale draft MSA section. Stronger stale penalties fixed that.
- Increasing source-local completion to 2 fixed the Acme account identity, but the better generic fix was role-heading scoring so identity slots prefer identity/header sections with `k=1`.
- Expected-place search initially still missed the discovery-call stakeholder absence because anti-decoy numeric terms from a task variant blocked a valid outside source. The final version lets a strong participant/stakeholder absence section bypass that numeric guard.
- The insurance unit test caught an implementation bug where source-local completion promoted an empty decoy document root. Empty-section guards fixed it.
- Broad/minimal mutations briefly picked up a non-authoritative standard contract policy decoy. Template/non-binding authority penalties removed the regression.

## Results

Baseline before this method:

- Normal/reference retrieval: `193/199` slot evidence, `98/106` required slots, `196/199` sections, `41/45` searched scope, `30` decoys.
- Reference output scoring: `179/179` accuracy, `176/179` citation validity, `203/208` citation authority, `27/29` abstention, `27/29` explanation.
- Mutations: broad `93/106` required, `39/45` scope, `188/199` sections, `29` decoys; minimal `75/106`, `34/45`, `158/199`, `23` decoys; corpus noise `98/106`, `41/45`, `196/199`, `27` decoys.

Final run:

- Normal/reference retrieval: `196/199` slot evidence, `102/106` required slots, `199/199` sections, `44/45` searched scope, `30` decoys.
- Reference output scoring: `179/179` accuracy, `179/179` citation validity, `208/208` citation authority, `29/29` abstention, `29/29` explanation.
- Decoy output safety: `0` decoy authority misuses, `0` decoy authority citations, `5` rejected decoy citations.
- Mutations: broad `96/106` required, `41/45` scope, `189/199` sections, `29` decoys; minimal `80/106`, `38/45`, `163/199`, `23` decoys; corpus noise `102/106`, `44/45`, `199/199`, `27` decoys.

## Remaining Misses

The normal panel still misses `3` slot evidence checks, `4` required slots, and `1` searched-scope item. The next fixes should focus on generic context-pack completeness rather than domain-specific vocabulary:

- Better multi-hop slot planning for cases where the needed section is not in the slot candidate pool.
- A safer per-slot diversity budget so one long/current source cannot crowd out a second required source.
- More explicit authority modeling for source type, freshness, and whether a section is binding or merely preference/template guidance.
