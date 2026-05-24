# ADR-0025: Code navigation fields and `get_code_chunk` are first-class MCP contract

**Status:** Accepted
**Date:** 2026-05-13

`retrieve_context_pack` should expose precise navigation metadata on ranked entries and a first-class code follow-up lookup tool. The additive contract revision is: ranked doc/code entries may carry structured location fields such as `source_path`, `start_line`, `end_line`, and code-specific fields such as `symbol_path` and `code_role`, while `get_code_chunk` becomes the code-side companion to `get_doc_chunk`.

We are recording this because PRD-0003 explicitly treats the MCP wire as a stable agent-facing contract, and these additions materially change how agents consume the pack. Without a recorded decision, future readers would see line-precise navigation fields and a new code lookup tool and not know whether they were accidental leakage from the retrieval internals or a deliberate product surface. The chosen direction is deliberate: once code becomes a first-class pack entry, agents need exact machine-readable navigation targets and a deterministic way to fetch the winning chunk or logical declaration view without falling back to ad hoc repo exploration.
