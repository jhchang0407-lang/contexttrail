export const PATH_TOPOLOGY_BOOSTS_DEFAULT_ON = false;

export function pathTopologyBoostsEnabledFromEnv(): boolean {
  const raw = process.env.RETRIEVAL_PATH_TOPOLOGY_BOOSTS;
  if (raw === undefined) return PATH_TOPOLOGY_BOOSTS_DEFAULT_ON;
  const lower = raw.toLowerCase();
  if (lower === "on") return true;
  if (lower === "off") return false;
  return PATH_TOPOLOGY_BOOSTS_DEFAULT_ON;
}

export const PATH_TOPOLOGY_CONDITIONAL_BOOSTS_DEFAULT_ON = true;

export function pathTopologyConditionalBoostsEnabledFromEnv(): boolean {
  const raw = process.env.RETRIEVAL_PATH_TOPOLOGY_CONDITIONAL_BOOSTS;
  if (raw === undefined) return PATH_TOPOLOGY_CONDITIONAL_BOOSTS_DEFAULT_ON;
  const lower = raw.toLowerCase();
  if (lower === "on" || lower === "1" || lower === "true") return true;
  if (lower === "off" || lower === "0" || lower === "false") return false;
  return PATH_TOPOLOGY_CONDITIONAL_BOOSTS_DEFAULT_ON;
}

export const HIERARCHY_INHERITANCE_DEFAULT_ON = true;

export function hierarchyInheritanceEnabledFromEnv(): boolean {
  const raw = process.env.RETRIEVAL_HIERARCHY_INHERITANCE;
  if (raw === undefined) return HIERARCHY_INHERITANCE_DEFAULT_ON;
  const lower = raw.toLowerCase();
  if (lower === "on" || lower === "1" || lower === "true") return true;
  if (lower === "off" || lower === "0" || lower === "false") return false;
  return HIERARCHY_INHERITANCE_DEFAULT_ON;
}

export function anchorIntentFallbackEnabledFromEnv(): boolean {
  const raw = process.env.RETRIEVAL_ANCHOR_INTENT_FALLBACK;
  if (raw === undefined) return false;
  const lower = raw.toLowerCase();
  return lower === "on" || lower === "1" || lower === "true";
}
