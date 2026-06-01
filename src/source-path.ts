import { isAbsolute, join, relative, sep } from "node:path";

export function absoluteSourcePath(cwd: string, sourcePath: string): string {
  return isAbsolute(sourcePath) ? sourcePath : join(cwd, sourcePath);
}

export function storageSourcePath(cwd: string, absolutePath: string): string {
  const rel = relative(cwd, absolutePath);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
    return normalizePathSeparators(rel);
  }
  return normalizePathSeparators(absolutePath);
}

export function normalizePathSeparators(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}
