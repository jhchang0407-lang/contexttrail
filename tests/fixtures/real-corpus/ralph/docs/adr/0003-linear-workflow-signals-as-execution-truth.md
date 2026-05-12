# Linear workflow signals as execution truth

Ralph treats the configured Linear workflow signals `needs_info`, `in_progress`, `in_review`, and `blocked` as required execution truth rather than optional decoration. If Ralph cannot write a required signal, it aborts the run after stage-appropriate rollback and artifact preservation so Linear never silently diverges from actual execution state.