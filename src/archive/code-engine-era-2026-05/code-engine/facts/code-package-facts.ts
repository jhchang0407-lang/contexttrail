import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import fg from "fast-glob";
import type {
  CodeSourceFacts,
  CodeSourcePackageFacts,
} from "../types/code-source.js";

export function withCodePackageFacts(
  facts: CodeSourceFacts,
  packageFacts: CodeSourcePackageFacts | null | undefined,
): CodeSourceFacts {
  if (!packageFacts) return facts;
  return {
    ...facts,
    package_facts: packageFacts,
  };
}

export function buildCodePackageFactsBySourcePath(args: {
  cwd: string;
  source_paths: readonly string[];
  ignore?: readonly string[];
}): Map<string, CodeSourcePackageFacts> {
  const packages = readPackageManifests(args.cwd, args.ignore ?? []);
  if (packages.length === 0) return new Map();
  const byName = new Map(
    packages
      .filter((pkg) => pkg.packageName !== null)
      .map((pkg) => [pkg.packageName!, pkg]),
  );
  for (const pkg of packages) {
    pkg.internalDependencyNames = pkg.dependencyNames.filter((name) =>
      byName.has(name),
    ).sort();
    pkg.internalDependencyRoots = pkg.internalDependencyNames
      .map((name) => byName.get(name)?.packageRoot)
      .filter((root): root is string => root !== undefined)
      .sort();
  }
  for (const pkg of packages) {
    for (const dependencyName of pkg.internalDependencyNames) {
      const dependency = byName.get(dependencyName);
      if (!dependency || !pkg.packageName) continue;
      dependency.internalDependentNames.push(pkg.packageName);
      dependency.internalDependentRoots.push(pkg.packageRoot);
    }
  }

  const sortedPackages = [...packages].sort(
    (a, b) => packageRootDepth(b.packageRoot) - packageRootDepth(a.packageRoot),
  );
  const out = new Map<string, CodeSourcePackageFacts>();
  for (const sourcePath of args.source_paths) {
    const owner = sortedPackages.find((pkg) =>
      pathIsWithinPackage(sourcePath, pkg.packageRoot),
    );
    if (!owner) continue;
    out.set(sourcePath, {
      package_root: owner.packageRoot,
      package_name: owner.packageName,
      manifest_path: owner.manifestPath,
      internal_dependency_names: unique(owner.internalDependencyNames),
      internal_dependency_roots: unique(owner.internalDependencyRoots),
      internal_dependent_names: unique(owner.internalDependentNames).sort(),
      internal_dependent_roots: unique(owner.internalDependentRoots).sort(),
      script_names: owner.scriptNames,
      export_keys: owner.exportKeys,
    });
  }
  return out;
}

type PackageManifestFacts = {
  packageRoot: string;
  packageName: string | null;
  manifestPath: string;
  dependencyNames: string[];
  internalDependencyNames: string[];
  internalDependencyRoots: string[];
  internalDependentNames: string[];
  internalDependentRoots: string[];
  scriptNames: string[];
  exportKeys: string[];
};

function readPackageManifests(
  cwd: string,
  ignore: readonly string[],
): PackageManifestFacts[] {
  const manifestPaths = fg.sync(["**/package.json"], {
    cwd,
    onlyFiles: true,
    dot: false,
    ignore: [
      "**/node_modules/**",
      "**/.git/**",
      "**/.contexttrail/**",
      ...ignore,
    ],
  }).sort();
  const out: PackageManifestFacts[] = [];
  for (const manifestPath of manifestPaths) {
    const abs = join(cwd, manifestPath);
    if (!existsSync(abs)) continue;
    const parsed = parseJsonObject(readFileSync(abs, "utf8"));
    if (!parsed) continue;
    out.push({
      packageRoot: normalizePackageRoot(dirname(manifestPath)),
      packageName: stringValue(parsed.name),
      manifestPath,
      dependencyNames: dependencyNamesFromManifest(parsed),
      internalDependencyNames: [],
      internalDependencyRoots: [],
      internalDependentNames: [],
      internalDependentRoots: [],
      scriptNames: objectKeys(parsed.scripts),
      exportKeys: exportKeysFromManifest(parsed.exports),
    });
  }
  return out;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function dependencyNamesFromManifest(pkg: Record<string, unknown>): string[] {
  return unique([
    ...objectKeys(pkg.dependencies),
    ...objectKeys(pkg.devDependencies),
    ...objectKeys(pkg.peerDependencies),
    ...objectKeys(pkg.optionalDependencies),
  ]).sort();
}

function exportKeysFromManifest(exportsField: unknown): string[] {
  if (typeof exportsField === "string") return ["."];
  if (!isObject(exportsField)) return [];
  return Object.keys(exportsField).sort();
}

function objectKeys(value: unknown): string[] {
  return isObject(value) ? Object.keys(value).sort() : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePackageRoot(path: string): string {
  return path === "." ? "." : path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function pathIsWithinPackage(sourcePath: string, packageRoot: string): boolean {
  const normalized = sourcePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (packageRoot === ".") return true;
  return normalized === packageRoot || normalized.startsWith(`${packageRoot}/`);
}

function packageRootDepth(packageRoot: string): number {
  if (packageRoot === ".") return 0;
  return packageRoot.split("/").filter(Boolean).length;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
