# Ralph

Ralph is a reusable executor that processes AFK-ready work items against multiple software repositories and projects through a consistent operator workflow.

## Language

**Ralph**:
A reusable executor that selects, runs, validates, and hands off AFK-ready ticket work.
_Avoid_: one-off repo script, single-repo wrapper

**Managed Repository**:
A source repository identified canonically by a normalized slug derived from its canonical git remote, which Ralph can inspect and modify under its execution rules.
_Avoid_: repo target, checkout, machine-local path identity

**Repo binding**:
The explicit normalized **Managed Repository** slug recorded in a normalized machine-owned ticket block and verified against the current **Managed Repository** during preflight. It may be corrected during normalization before first execution, but is frozen once the ticket branch is created.
_Avoid_: implicit repo guessing from freeform issue text, mid-execution retargeting

**LinearProject**:
A Linear project identified canonically by Linear ID, with human-readable names used only for display.
_Avoid_: fake-generic project term, display-name identity

**Linear issue key**:
The workspace-visible stable issue identifier used for human-facing branch names and artifact paths.
_Avoid_: opaque internal numeric ID in operator-facing surfaces

**Queue Query**:
A named first-class configured Linear filter over a small explicit v1 vocabulary — required **LinearProject**, included labels that must all be present, excluded labels that must all be absent, and allowed workflow states of which one must match — that determines which issues are eligible for a **Run**, with a human selection name and a derived execution fingerprint.
_Avoid_: agent queue project, permanent queue object, undocumented team convention, ad hoc CLI filter, embedded execution policy, arbitrary query language

**Repo-local config**:
The versioned human-authored configuration inside a **Managed Repository** that declares supported **LinearProjects**, their **Queue Queries**, execution policy defaults, named Linear constants, and the canonical git remote in one repo-level config surface.
_Avoid_: hidden central registry, ad hoc operator memory, mixed generated state, per-project config sprawl

**Resolved config**:
The generated repo-local file `.pi/executor.lock.yaml` stored adjacent to **Repo-local config** that stores resolved provider IDs and sync metadata derived from `.pi/executor.yaml`, and it is committed to git. Normal execution fails if it is out of sync with **Repo-local config** by fingerprint, schema compatibility, missing required IDs, or missing referenced entries.
_Avoid_: hand-editing generated identifiers into authored config, treating execution-critical IDs as unversioned local state, hiding generated config in ephemeral runtime directories, silent re-resolution during execution, filename aliases

**Linear constants**:
Named repo-local identifiers that resolve to canonical Linear label or workflow-state IDs for use as queue-selection inputs in **Queue Queries**, with names allowed only for bootstrap and display.
_Avoid_: repeated raw vendor strings scattered through config, unresolved runtime names, side-effecting transition semantics

**Linear team context**:
The single Linear workspace/team scope that a **Managed Repository** binds to in v1 for issue keys, labels, workflow states, queue queries, and configured workflow signals.
_Avoid_: mixing multiple team or workspace scopes inside one repo run surface

**Workflow signal**:
A configured Linear label or workflow state transition Ralph applies as a side effect for a specific operational meaning, using exactly one configured mechanism per signal. All lifecycle signals in v1 — including `needs_info`, `in_progress`, `in_review`, and `blocked` — are hard-required for ticket state truth and idempotent across retries and resume. Ralph is responsible for clearing `needs_info` only after both **Normalization** and **Packet resolution** succeed, while `blocked` is human-cleared only in v1.
_Avoid_: simultaneously driving the same signal through both label and state, using signals as queue-selection inputs

**Advisory comment**:
A non-blocking Linear write such as a human-readable comment that may fail without invalidating ticket execution state.
_Avoid_: treating optional commentary as equivalent to required workflow transitions

**Setup sync**:
A separate idempotent Ralph command that connects to Linear, resolves configured label and workflow-state names to IDs, writes them into `.pi/executor.lock.yaml`, and verifies the result. It supports interactive setup by default and non-interactive resolution when configured names resolve uniquely.
_Avoid_: manual config prep, implicit mutation during normal execution, silent ambiguity

**Execution policy**:
The configured behavior that governs how Ralph validates and retries work, defined by repo-wide defaults with optional direct **LinearProject** overrides in v1.
_Avoid_: embedding policy into **Queue Queries**, profile indirection

**Selection rule**:
Ralph auto-selects a **LinearProject** or **Queue Query** only when exactly one configured choice exists; otherwise the operator must choose explicitly.
_Avoid_: ambiguous implicit selection

**Query drift rule**:
During a **Run**, Ralph re-executes the same named **Queue Query** between tickets and accepts issue-set contexttrail, but a change to the query definition or fingerprint requires a fresh run.
_Avoid_: silently changing queue logic mid-run

**Resume rule**:
Ralph resumes a stored **Run** only when the current authored and resolved config snapshots still match the pinned run manifest; otherwise resume must refuse. When resuming an interrupted ticket, Ralph keeps the same ticket target but restarts that ticket's lifecycle from **Normalization**.
_Avoid_: auto-rebinding a run to changed config, trusting stale partial stage state

**Repo lock**:
A repository-wide execution lock that prevents concurrent Ralph activity within the same **Managed Repository**, regardless of **LinearProject** or **Queue Query**.
_Avoid_: project-scoped locking inside one checkout

**Run manifest**:
The persisted record of a **Run**, including the authored and resolved config fingerprints plus the selected **Queue Query** name, fingerprint, and full resolved filter body used at start.
_Avoid_: fingerprint-only audit trails, mid-run config ambiguity

**Normalization**:
Rewriting and validating the machine-owned execution contract on a Linear issue so it matches current repo config and ticket structure expectations before execution eligibility is assessed. If it fails or yields a non-executable contract, the ticket drops out of the current candidate set and Ralph applies an explicit needs-info workflow signal rather than marking the ticket blocked. It may rewrite machine-owned block contents but must not mutate any queue-selection labels, queue-selection states, or other **Linear constants** referenced by the active **Queue Query**.
_Avoid_: packet resolution, repo-state go/no-go checks

**Preflight**:
A deterministic go/no-go check run against a normalized ticket and current repo state before execution. If it fails for a ticket, that ticket is excluded for the remainder of the current **Run**. It is purely local and artifact-producing in v1, with no Linear side effects.
_Avoid_: rewriting ticket contracts, resolving worker excerpts, repeated same-run thrashing

**Packet resolution**:
Turning ticket refs such as `CONTEXT.md` sections and ADR identifiers into resolved excerpts assembled for worker input. It is pure and local in v1: it reads normalized tickets and repo files, writes only packet artifacts, and never mutates Linear or repo docs. If required refs are missing or stale, it is treated as a ticket-quality problem and should trigger `needs_info` rather than being treated as a transient execution failure.
_Avoid_: ticket normalization, repo-state eligibility checks

**Machine-owned ticket block**:
The executor-owned structured contract embedded in a Linear issue body that Ralph rewrites during **Normalization**.
_Avoid_: freeform human notes, second dependency authority

**Acceptance criteria**:
The ticket-defined outcome statements that outrank ADRs, `CONTEXT.md`, and PRD text when execution guidance conflicts.
_Avoid_: implicit success guesses, validator-only truth

**Checkpoint commit**:
A local-only green commit created by the worker at the end of a successful iteration before canonical validation and completion signaling.
_Avoid_: pushed final truth, known-failing snapshot

**Canonical commit**:
The validated final commit Ralph treats as the ticket's completion candidate before writing `in_review`.
_Avoid_: unvalidated worker checkpoint, hidden local-only result

**Handoff bundle**:
The artifact set Ralph preserves for human continuation when a ticket becomes `blocked` or takeover is required.
_Avoid_: ephemeral console-only failure context

**Run**:
A single execution session scoped to exactly one **Managed Repository**, one **LinearProject**, and one named **Queue Query**.
_Avoid_: global sweep, multi-repo batch, multi-queue invocation

**Provider-native term**:
A ticket-source concept should be named with the vendor's own vocabulary unless Ralph truly supports multiple providers behind a real shared abstraction.
_Avoid_: invented intermediate terms, fake-generic queue names

## Relationships

- **Ralph** executes issues that are eligible because they match a selected **Queue Query**
- A **Run** targets exactly one **Managed Repository**, one **LinearProject**, and one named **Queue Query**
- In v1, every issue selected by a **Queue Query** must belong to the targeted **LinearProject**
- Each **LinearProject** maps to exactly one **Managed Repository** in v1
- A **Managed Repository** may be used by multiple **LinearProjects** in v1
- The **Repo-local config** declares which **LinearProjects** and **Queue Queries** a **Managed Repository** supports
- **Queue Queries** reference **Linear constants** rather than repeating raw label or state strings
- Normal execution requires resolved Linear IDs; names are bootstrap-only and informational thereafter
- **Setup sync** owns Linear constant resolution and may be re-run to refresh **Resolved config** safely
- `.pi/executor.yaml` and `.pi/executor.lock.yaml` are both committed because intent and resolved provider identity are both execution-critical configuration
- `dry-run` and `execute` must fail on authored/resolved config drift and require **Setup sync**
- Remote provider drift is not a normal execution sync check; it is refreshed through **Setup sync** verification
- Multiple cloned working directories or parallel runs against the same **Managed Repository** are explicitly out of scope for v1
- Branch names remain ticket-centric in v1; project identity belongs in manifests and metadata rather than branch names
- Linear native dependencies are authoritative, and dependency snapshots should live in run artifacts rather than the machine-owned ticket block in v1
- Dependency and blocker gating comes from Linear metadata in v1, not from a second blocker system in the machine-owned ticket block
- **Normalization**, **Preflight**, and **Packet resolution** are distinct steps with distinct owners and artifacts; they must not overlap semantically
- **Normalization** rewrites the **Machine-owned ticket block**, while **Acceptance criteria** remain human-authored ticket truth
- Ralph never normalizes tickets outside the selected **Queue Query** result set in v1
- A **Normalization** failure is a ticket-quality problem and should trigger an explicit needs-info **Workflow signal**, not a blocked execution state
- Each **Workflow signal** uses exactly one mechanism in v1: either label or state, but never both
- Non-interactive **Setup sync** must fail on ambiguity rather than guessing
- **Execution policy** comes from repo-wide defaults with optional **LinearProject** overrides in v1
- One **Repo-local config** may define multiple **LinearProjects** for the same **Managed Repository**
- In v1, **LinearProjects** inherit only from repo defaults plus direct project overrides
- Label/state filters alone are insufficient in v1; **LinearProject** membership is mandatory for queue selection
- **LinearProject** membership is sufficient for issue selection, but **Repo binding** must still match during normalization and preflight
- The **Managed Repository** slug is derived from the canonical git remote declared in **Repo-local config**
- In v1, a **Managed Repository** binds to exactly one **Linear team context**
- **Workflow signals** are configured at the **Linear team context** level in v1
- **Linear constants** are read for queue selection, while **Workflow signals** are written for lifecycle transitions
- **Workflow signal** satisfaction is determined only from current Linear truth: label presence or absence in label mode, exact state ID match in state mode
- Lifecycle **Workflow signals** must be reconciled so stale states do not coexist incorrectly; state mode is naturally exclusive, and label mode must remove superseded lifecycle labels when writing a new lifecycle truth
- `needs_info` is also exclusive with `in_progress`, `in_review`, and `blocked`; a ticket cannot truthfully hold both ticket-quality failure and execution lifecycle states at once
- Even when signaling `blocked`, Ralph must not mutate human-owned queue-selection constants such as `autonomous_ok`
- Blocked tickets are excluded from future queue selection by **Queue Query** criteria that exclude the configured blocked lifecycle signal
- Tickets marked with `needs_info` are likewise excluded from future queue selection until that signal is cleared
- Tickets marked `in_progress` remain selectable so Ralph can rediscover and resume claimed work when appropriate
- If an `in_progress` ticket is rediscovered without matching local run state, Ralph may inspect it for visibility but must require explicit takeover before adopting execution
- Explicit takeover may adopt either `in_progress` tickets or `blocked` tickets with preserved handoff/checkpoint state
- Takeover starts a new **Run** linked to prior ticket artifacts rather than mutating the historical run identity
- Takeover preserves the same ticket branch identity when possible: reuse if valid, recreate with the same name if needed, and mint a suffixed fallback only when recreation is impossible
- Autonomous retry budget is ticket-scoped and inherited across runs, including takeover runs
- Explicit takeover does not bypass exhausted autonomous retry budget; it may continue only in deliberate human-steered mode unless a human explicitly resets ticket state or policy
- Takeover stays inside Ralph's artifact model and schema family, with manifests and results explicitly marking takeover or human-steered mode
- Even in takeover mode, normal Ralph execution does not mutate docs such as `CONTEXT.md`, ADRs, or PRD references unless a human performs a separate explicit action outside the standard loop
- A normalized ticket may carry zero documentation refs when represented explicitly, and this should warn but not reject the ticket by itself
- When documentation refs are present, **Packet resolution** should collect all unresolved refs and fail once with the complete set rather than failing on the first missing ref
- **Packet resolution** preserves the authored ref order in worker input so human ticket authors control narrative priority
- When clearing a state-mode `needs_info` **Workflow signal**, Ralph restores the prior state when known, with a configured fallback state if the prior state is unavailable
- Prior-state tracking for clearing state-mode `needs_info` lives in local artifacts, not in the machine-owned ticket block
- Selection is human authority; **Normalization** and other Ralph lifecycle actions must not mutate **Queue Query** inputs
- Branch creation is a preparation step that freezes **Repo binding**; the `in_progress` **Workflow signal** is written only after all gates pass and just before worker start
- The `in_progress` **Workflow signal** is an idempotent required signal: Ralph verifies it on resume and rewrites it only when needed to satisfy the configured mechanism
- Failure to write any required **Workflow signal** is treated as a systemic Linear failure that aborts the full **Run** after local rollback/artifact preservation appropriate to the stage reached
- If writing or clearing the required `needs_info` **Workflow signal** fails for any ticket-quality transition source, including **Normalization** or **Packet resolution**, Ralph aborts the full **Run** and records a run-abort artifact because ticket-quality truth was not made visible in Linear
- If writing the required `in_progress` **Workflow signal** fails, Ralph aborts that ticket, rolls back branch state, records a signal error artifact, and aborts the full **Run**
- If writing the required `in_review` **Workflow signal** fails after **Canonical commit** creation, Ralph reverts the canonical completion state, preserves the **Checkpoint commit**, records a signal error artifact, and aborts the full **Run**
- If writing the required `blocked` **Workflow signal** fails, Ralph still writes the **Handoff bundle**, records a signal error artifact, and aborts the full **Run**
- **Advisory comments** may fail without carrying the same hard-stop semantics as required **Workflow signals**
- The normalized **Managed Repository** slug is stored in both config and the machine-owned ticket block, then compared during preflight
- The **Linear issue key** is the canonical human-facing ticket identity for branches and artifact paths
- Artifact directories are keyed by **Linear issue key** alone in v1
- The **Selection rule** resolves a **Run** target from **Repo-local config** and explicit operator input when needed
- The **Query drift rule** allows eligible issues to change between tickets but freezes the chosen **Queue Query** definition for the life of a **Run**
- The **Run manifest** records both the audit identity and full resolved filter body of the selected **Queue Query**
- A **Run** freezes authored and resolved config snapshots for its full lifetime
- The **Resume rule** requires config snapshot identity to match before a stored **Run** may continue
- A resumed ticket that was already signaled `in_progress` remains `in_progress` while its lifecycle restarts from **Normalization**
- On resume, an existing ticket branch may be reused only if **Preflight** confirms it is clean and still matches stored ticket and base expectations; otherwise it must be reset or recreated
- Resume behavior depends on failure class: worker/validator-cycle retries may continue from a known-good checkpoint, while earlier-stage failures or unclear checkpoint trust must restart from the pinned base SHA
- The **Repo lock** is scoped to the entire **Managed Repository**, not to a project or query within it
- The lifecycle is: selected Linear issue from **Queue Query** → **Normalization** → **Preflight** → **Packet resolution** → branch creation → `in_progress` **Workflow signal** → worker → **Checkpoint commit** → validation → **Canonical commit** candidate
- A ticket that fails **Preflight** is skipped for the rest of the current **Run** and may be reconsidered only in a fresh run
- **Normalization**, **Preflight**, and **Packet resolution** are re-executed fresh on each new **Run**; prior artifacts are audit history, not authority
- A **Queue Query** is selected by name from **Repo-local config**, not composed ad hoc during normal execution
- A **LinearProject** is identified canonically by Linear ID; display names are informational only
- A **Queue Query** has a human-facing name and a derived fingerprint for audit and execution identity
- A **Queue Query** selects issues only; execution policy is configured separately
- Issue ordering is a runner rule, not part of **Queue Query** definition
- Vague "allowlist membership" language is replaced by explicit eligibility through **Queue Query** matching
- **Acceptance criteria** are the highest-priority execution truth when ticket guidance conflicts with ADRs, `CONTEXT.md`, or PRD text

## Example dialogue

> **Dev:** "Can one repo support more than one Linear project?"
> **Domain expert:** "Yes — a **Managed Repository** may back multiple **LinearProjects**, but each **Run** still picks exactly one **LinearProject** and one **Queue Query**."

## Flagged ambiguities

- Initial blueprint language said "single repo," but the intended product scope is reusable across multiple **Managed Repositories** and **Projects**.
- Product scope is multi-repo and multi-provider-capable over time, but each individual **Run** is single-repository and single-queue.
- Invented generic terms like "Project" for provider-specific queue concepts are rejected; use the vendor's vocabulary verbatim unless a real shared abstraction exists.
- For v1, the queue is not a first-class Linear object like a View; it is a runtime **Queue Query** over a **LinearProject**, labels, and states.
- The **Queue Query** is owned by **Repo-local config**, not by undocumented Linear workflow convention.
- In v1, a **LinearProject** maps to exactly one **Managed Repository**, but a **Managed Repository** may back multiple **LinearProjects**.
