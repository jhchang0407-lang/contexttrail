/**
 * Deterministic source role and
 * canonicality classifier.
 *
 * The existing `SourceProfile` carries a coarse `doc_purpose` enum.
 * The precision layer needs a richer overlay that speaks its
 * vocabulary (overview, guide, reference, api, config, concept,
 * decision, changelog, migration, troubleshooting, example,
 * child_detail, parent_container) plus a separate canonicality axis
 * (parent / child / leaf) that is independent of role.
 *
 * Outputs are deterministic and inspectable: every classification
 * carries an ordered list of provenance entries describing which
 * signal — doc_purpose, path basename, parent dir, title hint, …  —
 * contributed.
 *
 * Diagnostic-only today. Pairwise adjudication
 * is the stage that may consume role/canonicality for production
 * decisions.
 */
import type { DocPurpose, SourceProfile, PurposeSource } from "../types/source-profile.js";

export const SOURCE_ROLES = [
  "overview",
  "guide",
  "reference",
  "api",
  "config",
  "concept",
  "decision",
  "changelog",
  "migration",
  "troubleshooting",
  "example",
  "child_detail",
  "parent_container",
  "unknown",
] as const;
export type SourceRole = (typeof SOURCE_ROLES)[number];

export type SourceCanonicality = "parent" | "child" | "leaf" | "unknown";

export type SourceRoleConfidence = "high" | "medium" | "low" | "unknown";

export type SourceRoleProvenanceSignal =
  | "doc_purpose"
  | "doc_role"
  | "path_basename"
  | "path_parent_dir"
  | "path_index"
  | "path_sibling_index"
  | "title"
  | "h1"
  | "headings"
  | "default";

export type SourceRoleProvenanceEntry = {
  signal: SourceRoleProvenanceSignal;
  detail: string;
};

export type SourceRoleClassification = {
  role: SourceRole;
  canonicality: SourceCanonicality;
  confidence: SourceRoleConfidence;
  provenance: SourceRoleProvenanceEntry[];
};

export type ClassifySourceRoleArgs = {
  source_path: string;
  profile: SourceProfile | null;
  /** Other source paths in the same corpus. Used to detect parent/child
   *  relationships (e.g., `mocking/modules.md` is a child of a
   *  `mocking.md` sibling-index when both exist). Optional — when
   *  omitted, only path-internal canonicality cues run. */
  sibling_paths?: string[];
};

export function classifySourceRole(
  args: ClassifySourceRoleArgs,
): SourceRoleClassification {
  const { source_path, profile, sibling_paths } = args;
  const provenance: SourceRoleProvenanceEntry[] = [];

  // 1. Strong evidence from doc_purpose. Only "frontmatter" and
  //    "config_pattern" sources promote to high confidence; path/title
  //    rules are medium; default is treated as a weak inference.
  const purposeRole = roleFromDocPurpose(profile?.doc_purpose);
  let role: SourceRole = "unknown";
  let confidence: SourceRoleConfidence = "unknown";
  if (purposeRole && profile && profile.doc_purpose !== "unknown") {
    role = purposeRole;
    confidence = confidenceFromPurposeSource(profile.purpose_source);
    provenance.push({
      signal: "doc_purpose",
      detail: `${profile.doc_purpose} (source=${profile.purpose_source})`,
    });
  }

  // 2. Path-derived role overlays. Only override when stronger than
  //    the doc_purpose-derived confidence, or fill in unknown.
  const pathRole = roleFromPath(source_path);
  if (pathRole && (role === "unknown" || isPathRoleStronger(pathRole.role, role, confidence))) {
    role = pathRole.role;
    confidence = pathRole.confidence;
    provenance.push({ signal: pathRole.signal, detail: pathRole.detail });
  } else if (pathRole) {
    provenance.push({ signal: pathRole.signal, detail: `${pathRole.detail} (deferred to ${role})` });
  }

  // 3. Title / H1 hints. These are weak by design and never override
  //    a high-confidence doc_purpose. They (a) fill in unknown roles
  //    and (b) corroborate an existing low-confidence role from path
  //    so reports can show the title evidence in provenance.
  if (profile) {
    const titleRole = roleFromTitle(profile.title) || roleFromTitle(profile.h1 ?? "");
    if (titleRole) {
      if (role === "unknown") {
        role = titleRole.role;
        confidence = "low";
        provenance.push({ signal: titleRole.signal, detail: titleRole.detail });
      } else if (titleRole.role === role && confidence !== "high") {
        provenance.push({ signal: titleRole.signal, detail: `${titleRole.detail} (corroborates ${role})` });
      }
    }
  }

  // 4. Canonicality. Parent if basename is README/index, or matches
  //    its parent dir name, or has a sibling subdir of the same name.
  //    Child if a sibling parent-index exists for our parent dir.
  const canonicality = classifyCanonicality(source_path, sibling_paths);
  if (canonicality !== "unknown") {
    const detail =
      canonicality === "parent"
        ? "basename or sibling structure indicates parent index"
        : canonicality === "child"
          ? "sibling parent index detected"
          : "default leaf";
    provenance.push({
      signal: canonicality === "child" ? "path_sibling_index" : "path_index",
      detail,
    });
  }

  // 5. When canonicality is "parent" and no other role attached,
  //    surface parent_container so reports have a useful label.
  if (role === "unknown" && canonicality === "parent") {
    role = "parent_container";
    confidence = "medium";
  }

  if (role === "unknown" && provenance.length === 0) {
    provenance.push({ signal: "default", detail: "no signal matched" });
  }

  return { role, canonicality, confidence, provenance };
}

function roleFromDocPurpose(purpose: DocPurpose | undefined): SourceRole | null {
  switch (purpose) {
    case "api_reference":
      return "api";
    case "concept":
      return "concept";
    case "guide":
    case "quick_start":
      return "guide";
    case "migration":
      return "migration";
    case "changelog":
    case "release_note":
      return "changelog";
    case "runbook":
      return "troubleshooting";
    case "adr":
    case "prd":
      return "decision";
    case "readme":
    case "package_readme":
      return "overview";
    case "example":
      return "example";
    case "unknown":
    case undefined:
      return null;
    default:
      return null;
  }
}

function confidenceFromPurposeSource(source: PurposeSource): SourceRoleConfidence {
  switch (source) {
    case "frontmatter":
    case "config_pattern":
      return "high";
    case "path_rule":
    case "title_rule":
    case "content_rule":
      return "medium";
    case "default":
      return "low";
    default:
      return "low";
  }
}

type PathRoleHit = {
  role: SourceRole;
  confidence: SourceRoleConfidence;
  signal: SourceRoleProvenanceSignal;
  detail: string;
};

function roleFromPath(source_path: string): PathRoleHit | null {
  const lowered = source_path.toLowerCase();
  const basename = lowered.split("/").pop() ?? "";
  const stem = basename.replace(/\.[^.]*$/, "");
  const parentDir = lowered.split("/").slice(0, -1).pop() ?? "";

  // Config — only when the entire basename or the immediate parent dir
  // is exactly a config/settings name. Substring matches against
  // hyphenated stems like `0004-authored-and-lock-config-split` are
  // false positives (the file is an ADR about config, not a config
  // doc) and would otherwise overrule the doc_purpose-derived role.
  if (
    stem === "config" ||
    stem === "configuration" ||
    stem === "settings" ||
    parentDir === "config" ||
    parentDir === "configuration" ||
    parentDir === "settings"
  ) {
    return {
      role: "config",
      confidence: "medium",
      signal:
        stem === "config" || stem === "configuration" || stem === "settings"
          ? "path_basename"
          : "path_parent_dir",
      detail: `path stem='${stem}' parent='${parentDir}'`,
    };
  }

  // Troubleshooting / FAQ.
  if (
    stem === "troubleshooting" ||
    stem === "faq" ||
    /troubleshoot/.test(stem) ||
    parentDir === "troubleshooting" ||
    parentDir === "faq"
  ) {
    return {
      role: "troubleshooting",
      confidence: "medium",
      signal: "path_basename",
      detail: `path stem='${stem}'`,
    };
  }

  // Examples / samples.
  if (parentDir === "examples" || parentDir === "samples" || stem === "example" || stem === "sample") {
    return {
      role: "example",
      confidence: "medium",
      signal: "path_parent_dir",
      detail: `parent='${parentDir}'`,
    };
  }

  // Migration / upgrade.
  if (stem === "migration" || stem === "upgrade" || stem === "migrating" || parentDir === "migration") {
    return {
      role: "migration",
      confidence: "medium",
      signal: "path_basename",
      detail: `path stem='${stem}'`,
    };
  }

  // Changelog / releases.
  if (stem === "changelog" || stem === "releases" || stem === "release-notes" || stem === "release_notes") {
    return {
      role: "changelog",
      confidence: "medium",
      signal: "path_basename",
      detail: `path stem='${stem}'`,
    };
  }

  // ADR / decision.
  if (parentDir === "adr" || parentDir === "decisions" || parentDir === "rfc" || parentDir === "rfcs") {
    return {
      role: "decision",
      confidence: "medium",
      signal: "path_parent_dir",
      detail: `parent='${parentDir}'`,
    };
  }

  // API reference dir.
  if (parentDir === "api" || stem === "api-reference" || stem === "api_reference") {
    return {
      role: "api",
      confidence: "medium",
      signal: "path_parent_dir",
      detail: `parent='${parentDir}'`,
    };
  }

  return null;
}

/** Path-derived role beats an existing role only when it adds
 *  information the doc_purpose mapping missed and the existing role is
 *  weakly supported. A medium-confidence doc_purpose (path_rule /
 *  title_rule / content_rule) is treated as authoritative — overriding
 *  it from a path stem match was the source of the V5.x style
 *  regressions where an ADR about config got reclassified as a config
 *  doc. */
function isPathRoleStronger(
  pathRole: SourceRole,
  existingRole: SourceRole,
  existingConfidence: SourceRoleConfidence,
): boolean {
  if (existingConfidence === "high" || existingConfidence === "medium") return false;
  if (pathRole === existingRole) return false;
  return existingConfidence === "low" || existingConfidence === "unknown";
}

function roleFromTitle(text: string): { role: SourceRole; signal: SourceRoleProvenanceSignal; detail: string } | null {
  if (!text) return null;
  const lowered = text.toLowerCase();
  if (/\bmigration|\bupgrade|\bmigrating\b/.test(lowered)) {
    return { role: "migration", signal: "title", detail: `title='${text}'` };
  }
  if (/\bconfiguration\b|\bsettings\b/.test(lowered)) {
    return { role: "config", signal: "title", detail: `title='${text}'` };
  }
  if (/\btroubleshoot|\bfaq\b/.test(lowered)) {
    return { role: "troubleshooting", signal: "title", detail: `title='${text}'` };
  }
  if (/\bchangelog\b|\brelease(s)?(\snotes?)?\b/.test(lowered)) {
    return { role: "changelog", signal: "title", detail: `title='${text}'` };
  }
  return null;
}

function classifyCanonicality(source_path: string, sibling_paths?: string[]): SourceCanonicality {
  const lowered = source_path.toLowerCase();
  const segments = lowered.split("/");
  const basename = segments[segments.length - 1] ?? "";
  const stem = basename.replace(/\.[^.]*$/, "");
  const parentDir = segments[segments.length - 2] ?? "";

  // index.md / readme.md is a parent container.
  if (stem === "index" || stem === "readme") return "parent";

  // Same name as parent dir → file is the canonical entry into the subtree.
  if (parentDir && stem === parentDir) return "parent";

  if (sibling_paths) {
    // Sibling-index parent: this file's stem-as-directory is a prefix
    // of any sibling path. E.g. for `docs/mocking.md`, any sibling
    // beginning with `docs/mocking/` makes this file a parent.
    const baseDir = segments.slice(0, -1).join("/");
    const stemDirPrefix = (baseDir ? `${baseDir}/` : "") + `${stem}/`;
    if (
      sibling_paths.some((s) => {
        const sLower = s.toLowerCase();
        return sLower !== lowered && sLower.startsWith(stemDirPrefix);
      })
    ) {
      return "parent";
    }

    // Sibling-index child: a parent-index file exists for our parent
    // dir. For `docs/mocking/modules.md`, look for `docs/mocking.md`
    // or `docs/mocking/index.md` in siblings.
    if (parentDir) {
      const grandBase = segments.slice(0, -2).join("/");
      const candidateA = (grandBase ? `${grandBase}/` : "") + `${parentDir}.md`;
      const candidateB = (grandBase ? `${grandBase}/` : "") + `${parentDir}/${parentDir}.md`;
      const candidateC = (grandBase ? `${grandBase}/` : "") + `${parentDir}/index.md`;
      if (
        sibling_paths.some((s) => {
          const sLower = s.toLowerCase();
          return sLower === candidateA || sLower === candidateB || sLower === candidateC;
        })
      ) {
        return "child";
      }
    }
  }

  return "leaf";
}
