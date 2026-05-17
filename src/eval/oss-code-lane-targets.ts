import { existsSync } from "node:fs";
import { join } from "node:path";

export type OssCodeLaneTargetBucket =
  | "eligible"
  | "non_code_extension"
  | "declaration_file"
  | "test"
  | "examples"
  | "fixtures"
  | "docs"
  | "dependency_or_build_output"
  | "generated_or_snapshot"
  | "build_tooling"
  | "missing_at_head";

export type OssCodeLaneTargetClassification = {
  eligible: boolean;
  bucket: OssCodeLaneTargetBucket;
  normalizedPath: string;
};

const OSS_CODE_LANE_SOURCE_FILE_RE = /\.(?:ts|tsx|js|jsx|py|go|rs)$/i;

export function classifyOssCodeLaneTargetFile(args: {
  file: string;
  repoRoot?: string;
}): OssCodeLaneTargetClassification {
  const normalizedPath = normalizeEvalPath(args.file);

  if (!OSS_CODE_LANE_SOURCE_FILE_RE.test(normalizedPath)) {
    return { eligible: false, bucket: "non_code_extension", normalizedPath };
  }
  if (normalizedPath.endsWith(".d.ts")) {
    return { eligible: false, bucket: "declaration_file", normalizedPath };
  }
  if (isTestPath(normalizedPath)) {
    return { eligible: false, bucket: "test", normalizedPath };
  }
  if (hasPathSegment(normalizedPath, "examples")) {
    return { eligible: false, bucket: "examples", normalizedPath };
  }
  if (hasPathSegment(normalizedPath, "fixtures")) {
    return { eligible: false, bucket: "fixtures", normalizedPath };
  }
  if (hasPathSegment(normalizedPath, "docs")) {
    return { eligible: false, bucket: "docs", normalizedPath };
  }
  if (isDependencyOrBuildOutputPath(normalizedPath)) {
    return {
      eligible: false,
      bucket: "dependency_or_build_output",
      normalizedPath,
    };
  }
  if (isGeneratedOrSnapshotPath(normalizedPath)) {
    return {
      eligible: false,
      bucket: "generated_or_snapshot",
      normalizedPath,
    };
  }
  if (hasPathSegment(normalizedPath, "build")) {
    return { eligible: false, bucket: "build_tooling", normalizedPath };
  }
  if (args.repoRoot && !existsSync(join(args.repoRoot, normalizedPath))) {
    return { eligible: false, bucket: "missing_at_head", normalizedPath };
  }
  return { eligible: true, bucket: "eligible", normalizedPath };
}

export function isOssCodeLaneTargetFile(args: {
  file: string;
  repoRoot?: string;
}): boolean {
  return classifyOssCodeLaneTargetFile(args).eligible;
}

export function summarizeOssCodeLaneTargetBuckets(args: {
  files: readonly string[];
  repoRoot?: string;
}): Partial<Record<OssCodeLaneTargetBucket, number>> {
  const out: Partial<Record<OssCodeLaneTargetBucket, number>> = {};
  for (const file of args.files) {
    const bucket = classifyOssCodeLaneTargetFile({
      file,
      repoRoot: args.repoRoot,
    }).bucket;
    out[bucket] = (out[bucket] ?? 0) + 1;
  }
  return out;
}

function normalizeEvalPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isTestPath(path: string): boolean {
  return (
    path.includes(".test.") ||
    path.includes(".spec.") ||
    /_test\.(?:go|rs|py)$/i.test(path) ||
    hasPathSegment(path, "test") ||
    hasPathSegment(path, "tests") ||
    hasPathSegment(path, "__tests__")
  );
}

function isDependencyOrBuildOutputPath(path: string): boolean {
  return ["node_modules", "vendor", "target", "dist", "coverage"].some(
    (segment) => hasPathSegment(path, segment),
  );
}

function isGeneratedOrSnapshotPath(path: string): boolean {
  return /(?:^|\/)(?:generated|__generated__|gen|snapshots?|__snapshots__)(?:\/|$)/i.test(
    path,
  );
}

function hasPathSegment(path: string, segment: string): boolean {
  return path === segment || path.startsWith(`${segment}/`) ||
    path.includes(`/${segment}/`) || path.endsWith(`/${segment}`);
}
