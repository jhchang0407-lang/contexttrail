export type QueryAnchorSet = {
  files?: string[];
  symbols?: string[];
  routes?: string[];
};

export function hasQueryAnchors(anchors: QueryAnchorSet): boolean {
  return (
    (anchors.files?.length ?? 0) > 0 ||
    (anchors.symbols?.length ?? 0) > 0 ||
    (anchors.routes?.length ?? 0) > 0
  );
}

export function missingQueryAnchorRequests(anchors: QueryAnchorSet): string[] {
  const requests: string[] = [];
  if ((anchors.files ?? []).length === 0) requests.push("a relevant document or file path");
  if ((anchors.symbols ?? []).length === 0) {
    requests.push("an exact name from the documents (a form field, clause, ID, or term)");
  }
  if ((anchors.routes ?? []).length === 0) {
    requests.push("an identifier such as a claim number, policy id, or account key");
  }
  return requests;
}

export function topDirectoryGroups(files: string[]): Set<string> {
  const groups = new Set<string>();
  for (const file of files) {
    const parts = file.split("/").filter(Boolean);
    if (parts.length >= 2) groups.add(parts.slice(0, 2).join("/"));
    else groups.add(parts[0] ?? "");
  }
  return groups;
}
