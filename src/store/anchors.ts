import type { Db } from "./db.js";
import type {
  CodeAnchor,
  CodeAnchorConfidence,
  CodeAnchorKind,
  CodeAnchorSource,
} from "../types/chunk.js";
import {
  deleteChunkAnchorsInSubstrate,
  upsertChunkAnchorToSubstrate,
} from "./substrate-sync.js";

const UPSERT_SQL = `
INSERT INTO code_anchors (chunk_version_id, kind, value, confidence, source)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(chunk_version_id, kind, value) DO UPDATE SET
  confidence=excluded.confidence,
  source=excluded.source
`;

export function upsertAnchor(db: Db, a: CodeAnchor): void {
  db.prepare(UPSERT_SQL).run(
    a.chunk_version_id,
    a.kind,
    a.value,
    a.confidence,
    a.source,
  );
  upsertChunkAnchorToSubstrate(db, a);
}

export function deleteAnchorsForChunk(db: Db, version_id: string): void {
  db.prepare("DELETE FROM code_anchors WHERE chunk_version_id=?").run(version_id);
  deleteChunkAnchorsInSubstrate(db, version_id);
}

export function getAnchorsForChunk(db: Db, version_id: string): CodeAnchor[] {
  return (
    db
      .prepare(
        "SELECT chunk_version_id, kind, value, confidence, source FROM code_anchors WHERE chunk_version_id=?",
      )
      .all(version_id) as {
      chunk_version_id: string;
      kind: CodeAnchorKind;
      value: string;
      confidence: CodeAnchorConfidence;
      source: CodeAnchorSource;
    }[]
  );
}
