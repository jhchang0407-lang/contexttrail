# ADR-0023: Code retrieval is chunk-first, with the file graph as late augmentation

**Status:** Accepted
**Date:** 2026-05-13

Code retrieval should move to a chunk-first shape: first-class code chunks become the primary retrieval and packing unit, while the existing file-level code-source and import-graph layer remains the parent identity and neighborhood substrate. The import graph stays file-level and late only: direct code winners are chosen first, then a small bounded set of neighboring files may contribute their best code chunk if the task still needs structural support.

We are recording this because the alternatives were materially different and future readers will otherwise wonder why ContextTrail did not stay file-card-first or go graph-first. File-card-first kept prompt context too weak for implementation work, while graph-first created large candidate mass before the engine had proven direct code identity. The chosen shape preserves deterministic-core behavior, keeps code inside the real pack budget authority, and avoids promoting code chunks into authority-bearing Context Objects before the product actually needs that substrate step.
