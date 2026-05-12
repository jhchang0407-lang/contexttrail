import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { ConfigSchema, type ContextTrailConfig } from "./defaults.js";

export const CONFIG_REL_PATH = ".contexttrail/config.yaml";

export function loadConfig(cwd: string): ContextTrailConfig {
  const path = join(cwd, CONFIG_REL_PATH);
  if (!existsSync(path)) {
    return ConfigSchema.parse({});
  }
  const raw = readFileSync(path, "utf8");
  const data = parseYaml(raw) ?? {};
  const parsed = ConfigSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `Invalid .contexttrail/config.yaml:\n${parsed.error.toString()}`,
    );
  }
  return parsed.data;
}
