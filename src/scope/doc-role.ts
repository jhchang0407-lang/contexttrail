import type { ContextTrailConfig } from "../config/defaults.js";
import { matchesGlob } from "./rules.js";
import type { DocRole, RoleSource } from "../types/chunk.js";

const ROLES = new Set(["canonical", "ideation", "example", "archive"]);

export function resolveDocRole(args: {
  source_path: string;
  frontmatter: Record<string, unknown>;
  config: ContextTrailConfig;
}): { doc_role: DocRole; role_source: RoleSource } {
  const frontmatterRole = args.frontmatter.doc_role;
  if (typeof frontmatterRole === "string") {
    if (!ROLES.has(frontmatterRole)) {
      throw new Error(`invalid doc_role frontmatter: ${frontmatterRole}`);
    }
    return { doc_role: frontmatterRole as DocRole, role_source: "frontmatter" };
  }
  const rule = args.config.doc_roles.find((r) => matchesGlob(args.source_path, r.pattern));
  if (rule) return { doc_role: rule.role, role_source: "config_pattern" };
  return { doc_role: "canonical", role_source: "default" };
}
