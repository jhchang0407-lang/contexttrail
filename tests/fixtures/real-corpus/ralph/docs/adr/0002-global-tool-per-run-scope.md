# Global tool with per-run scope

Ralph is installed and reused globally across repositories and projects, but each run is scoped to exactly one checked-out repository, one selected `LinearProject`, and one selected named `QueueQuery`. This keeps the product reusable while preserving simple locking, git safety, queue semantics, and auditability within a run.