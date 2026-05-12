# Ralph

Ralph is the autonomous serial ticket executor described in [README.md](README.md). This file is the agent-facing entry point — both Claude Code and the Pi agent read it.

## Agent skills

### Issue tracker

Issues and PRDs live in Linear (workspace `thomaschang`, team `THO`, project `Ralph`). See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

Five canonical roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) map to Linear labels of the same name on the `THO` team. See [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

### Domain docs

Single-context repo: glossary at [CONTEXT.md](CONTEXT.md), ADRs under [docs/adr/](docs/adr/), architecture under [docs/architecture/](docs/architecture/), PRDs under [docs/prd/](docs/prd/). See [docs/agents/domain.md](docs/agents/domain.md).

## Note on agent independence

This repo is read by both Claude Code and the Pi agent. Their global skill installations (`~/.claude/skills/` and `~/.agents/skills/`) are independent files — neither symlinks nor APFS-cloned. When you update a Matt Pocock skill in one installation, also update the other. The per-repo agent config under `docs/agents/` is the only shared source of truth.
