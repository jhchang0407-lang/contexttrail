import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { promisify } from "node:util";
import {
  acceptSuggestion,
  answerSuggestion,
  bootstrapSuggestions,
  buildUiState,
  createAcceptedRule,
  importDocumentGlobs,
  applyTaskProfileFromUi,
  previewContextFromUi,
  rejectSuggestion,
  replaceDocumentSourceFromUi,
  saveDocumentSourceFromUi,
  saveTaskProfileFromUi,
  syncFromUi,
  uploadDocuments,
  uploadRuleSources,
  type UploadedTextFile,
} from "./state.js";

export type UiServerOptions = {
  cwd: string;
  host?: string;
  port?: number;
};

export type StartedUiServer = {
  server: Server;
  url: string;
  port: number;
};

type JsonRecord = Record<string, unknown>;

const execFileAsync = promisify(execFile);

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function startUiServer(
  options: UiServerOptions,
): Promise<StartedUiServer> {
  const host = options.host ?? "127.0.0.1";
  const startPort = options.port ?? 4317;
  // Set once the listener is bound; requests cannot arrive before then.
  let listeningPort = startPort;
  const server = createServer((req, res) => {
    void handleRequest(options.cwd, listeningPort, req, res);
  });
  const port = await listenOnAvailablePort(server, host, startPort);
  listeningPort = port;
  return {
    server,
    port,
    url: `http://${host}:${port}`,
  };
}

export async function runUiServer(options: UiServerOptions): Promise<void> {
  const started = await startUiServer(options);
  console.log(`ContextTrail UI running at ${started.url}`);
  console.log("Press Ctrl+C to stop.");
}

async function handleRequest(
  cwd: string,
  port: number,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    assertSameOriginForStateChange(req, url.pathname, port);
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      sendHtml(res, APP_HTML);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(res, await buildUiState(cwd));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/fs/choose-folder") {
      sendJson(res, await chooseNativeFolder(cwd));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/documents/import") {
      const body = await readJson<{ patterns?: string[] }>(req);
      sendJson(res, importDocumentGlobs(cwd, stringArray(body.patterns)));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/context/preview") {
      const body = await readJson<{ task?: string; budget?: "small" | "default" | "large" }>(req);
      sendJson(res, await previewContextFromUi(cwd, {
        task: body.task,
        budget: budgetValue(body.budget),
      }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/document-sources") {
      const body = await readJson<{ path?: string; glob?: string }>(req);
      sendJson(res, saveDocumentSourceFromUi(cwd, {
        path: requireString(body.path, "path"),
        glob: typeof body.glob === "string" ? body.glob : undefined,
      }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/document-sources/replace") {
      const body = await readJson<{ path?: string; glob?: string }>(req);
      sendJson(res, replaceDocumentSourceFromUi(cwd, {
        path: requireString(body.path, "path"),
        glob: typeof body.glob === "string" ? body.glob : undefined,
      }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/task-profiles") {
      const body = await readJson<{ name?: string; mode?: "current" | "empty" }>(req);
      sendJson(res, saveTaskProfileFromUi(cwd, {
        name: typeof body.name === "string" ? body.name : undefined,
        mode: body.mode === "empty" ? "empty" : "current",
      }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/documents/upload") {
      const body = await readJson<{ files?: UploadedTextFile[] }>(req, 20 * 1024 * 1024);
      sendJson(res, uploadDocuments(cwd, uploadedFiles(body.files)));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/rule-sources/upload") {
      const body = await readJson<{ files?: UploadedTextFile[] }>(req, 20 * 1024 * 1024);
      sendJson(res, uploadRuleSources(cwd, uploadedFiles(body.files)));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/rules") {
      const body = await readJson<{ title?: string; body?: string; scope?: JsonRecord }>(req);
      sendJson(res, createAcceptedRule(cwd, {
        title: body.title,
        body: requireString(body.body, "body"),
        scope: body.scope,
      }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/suggestions/bootstrap") {
      sendJson(res, await bootstrapSuggestions(cwd));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/sync") {
      const body = await readJson<{ check?: boolean; refresh_candidates?: boolean }>(req);
      sendJson(res, await syncFromUi(cwd, body));
      return;
    }
    const suggestionMatch = url.pathname.match(/^\/api\/suggestions\/([^/]+)\/(accept|reject|answer)$/);
    if (req.method === "POST" && suggestionMatch) {
      const id = decodeURIComponent(suggestionMatch[1] ?? "");
      const action = suggestionMatch[2];
      if (action === "accept") sendJson(res, acceptSuggestion(cwd, id));
      else if (action === "reject") sendJson(res, rejectSuggestion(cwd, id));
      else {
        const body = await readJson<{ choice_id?: string; free_text?: string }>(req);
        sendJson(res, answerSuggestion(cwd, id, body));
      }
      return;
    }
    const profileMatch = url.pathname.match(/^\/api\/task-profiles\/([^/]+)\/apply$/);
    if (req.method === "POST" && profileMatch) {
      sendJson(res, applyTaskProfileFromUi(cwd, decodeURIComponent(profileMatch[1] ?? "")));
      return;
    }
    throw new HttpError(404, "not found");
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    sendJson(res, {
      error: err instanceof Error ? err.message : String(err),
    }, status);
  }
}

/**
 * CSRF guard for the localhost UI. Browsers attach an Origin header to all
 * cross-origin requests (and same-origin POSTs), so any state-changing
 * request carrying a non-local Origin is a cross-site request from a web
 * page and must be rejected. Requests without an Origin header (curl,
 * same-origin top-level navigations) stay allowed.
 */
function assertSameOriginForStateChange(
  req: IncomingMessage,
  pathname: string,
  port: number,
): void {
  const method = (req.method ?? "GET").toUpperCase();
  const stateChanging =
    method === "POST" ||
    method === "PUT" ||
    method === "DELETE" ||
    (method === "GET" && pathname === "/api/fs/choose-folder");
  if (!stateChanging) return;
  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin.length === 0) return;
  const allowed = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
  ]);
  if (!allowed.has(origin)) {
    throw new HttpError(403, "cross-origin requests are not allowed");
  }
}

function listenOnAvailablePort(
  server: Server,
  host: string,
  startPort: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if (err.code === "EADDRINUSE") {
          tryPort(port + 1);
          return;
        }
        reject(err);
      };
      const onListening = () => {
        server.off("error", onError);
        const address = server.address();
        resolve(typeof address === "object" && address ? address.port : port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    };
    tryPort(startPort);
  });
}

async function readJson<T>(req: IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<T> {
  const contentType = req.headers["content-type"];
  if (typeof contentType === "string" && contentType.length > 0) {
    const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") {
      throw new HttpError(415, "content-type must be application/json");
    }
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new HttpError(413, "request body too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {} as T;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendHtml(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function budgetValue(value: unknown): "small" | "default" | "large" | undefined {
  return value === "small" || value === "default" || value === "large" ? value : undefined;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${name} is required`);
  }
  return value;
}

function uploadedFiles(value: unknown): UploadedTextFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): UploadedTextFile[] => {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as UploadedTextFile).name === "string"
    ) {
      const file = item as UploadedTextFile;
      if (typeof file.content === "string") {
        return [{ name: file.name, content: file.content }];
      }
      if (typeof file.data_base64 === "string") {
        return [{
          name: file.name,
          data_base64: file.data_base64,
          content_type: typeof file.content_type === "string" ? file.content_type : undefined,
        }];
      }
    }
    return [];
  });
}

async function chooseNativeFolder(cwd: string): Promise<{ path: string | null; cancelled: boolean }> {
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync("osascript", [
        "-e",
        `set defaultFolder to POSIX file "${escapeAppleScript(cwd)}" as alias`,
        "-e",
        "set chosenFolder to choose folder with prompt \"Choose document folder for ContextTrail\" default location defaultFolder",
        "-e",
        "POSIX path of chosenFolder",
      ], { timeout: 120_000 });
      return { path: stdout.trim().replace(/\/$/, ""), cancelled: false };
    } catch (err) {
      if (isUserCancelled(err)) return { path: null, cancelled: true };
      throw err;
    }
  }
  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$dialog.Description = 'Choose document folder for ContextTrail'",
      `$dialog.SelectedPath = '${escapePowerShell(cwd)}'`,
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) } else { exit 2 }",
    ].join("; ");
    try {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-STA",
        "-Command",
        script,
      ], { timeout: 120_000 });
      return { path: stdout.trim(), cancelled: false };
    } catch (err) {
      if (isUserCancelled(err)) return { path: null, cancelled: true };
      throw err;
    }
  }
  throw new HttpError(501, "native folder picker is not supported on this OS yet");
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''");
}

function isUserCancelled(err: unknown): boolean {
  const code = typeof err === "object" && err && "code" in err ? (err as { code?: unknown }).code : undefined;
  const message = err instanceof Error ? err.message : String(err);
  return code === 1 || code === 2 || /user canceled|cancelled|cancel/i.test(message);
}

const APP_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ContextTrail UI</title>
  <link rel="icon" href="data:,">
  <style>
    :root {
      --bg: #f6f7f5;
      --panel: #ffffff;
      --soft: #eff4ef;
      --ink: #1e2521;
      --muted: #63716b;
      --line: #d8ded8;
      --line-strong: #b9c3bd;
      --green: #237a57;
      --blue: #266a99;
      --amber: #966912;
      --red: #a33a33;
      --green-soft: #e5f3ec;
      --blue-soft: #e7f1f7;
      --amber-soft: #fff2cf;
      --red-soft: #fae7e5;
      --charcoal: #2d3330;
      --shadow: 0 14px 40px rgba(30, 42, 35, 0.08);
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--ink);
      font: 14px/1.4 var(--sans);
      letter-spacing: 0;
    }
    button, input, textarea, select { font: inherit; letter-spacing: 0; }
    button { cursor: pointer; border: 0; }
    .topbar {
      min-height: 64px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 12px 28px;
      background: rgba(255,255,255,0.88);
      border-bottom: 1px solid var(--line);
      position: sticky;
      top: 0;
      z-index: 5;
      backdrop-filter: blur(12px);
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .mark {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      display: grid;
      place-items: center;
      background: var(--charcoal);
      color: white;
      font-weight: 800;
    }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 17px; line-height: 1.1; }
    h2 { font-size: 16px; }
    h3 { font-size: 14px; }
    .subtle { color: var(--muted); font-size: 12px; }
    .top-actions, .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .btn {
      min-height: 36px;
      border-radius: 8px;
      border: 1px solid var(--line-strong);
      padding: 0 12px;
      background: white;
      color: var(--ink);
      font-weight: 680;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      justify-content: center;
    }
    .btn.primary { background: var(--charcoal); color: white; border-color: var(--charcoal); }
    .btn.green { background: var(--green); color: white; border-color: var(--green); }
    .btn.danger { color: var(--red); border-color: rgba(163,58,51,0.35); background: white; }
    .btn.icon { width: 36px; padding: 0; }
    .app {
      width: min(1460px, calc(100vw - 36px));
      margin: 26px auto 90px;
      display: grid;
      gap: 18px;
    }
    .setup-strip {
      display: grid;
      grid-template-columns: 260px minmax(0,1fr);
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .strip-head {
      padding: 16px;
      border-right: 1px solid var(--line);
      background: #fbfcfb;
    }
    .steps {
      padding: 10px;
      display: grid;
      grid-template-columns: repeat(4,minmax(0,1fr));
      gap: 8px;
    }
    .step {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      display: grid;
      grid-template-columns: 34px 1fr auto;
      gap: 10px;
      align-items: center;
      background: white;
    }
    .step.active { border-color: rgba(35,122,87,0.45); background: var(--green-soft); }
    .step strong { display: block; line-height: 1.2; }
    .step .subtle { display: block; margin-top: 3px; }
    .step-icon {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      display: grid;
      place-items: center;
      background: var(--soft);
      color: var(--muted);
    }
    .workspace {
      display: grid;
      grid-template-columns: minmax(0,1fr) 380px;
      gap: 18px;
      align-items: start;
    }
    .stack { display: grid; gap: 18px; }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .panel-head {
      min-height: 58px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .panel-body { padding: 16px; }
    .metric-row {
      display: grid;
      grid-template-columns: repeat(4,minmax(0,1fr));
      gap: 10px;
      margin-bottom: 16px;
    }
    .metric, .summary-item {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fbfcfb;
      padding: 12px;
    }
    .metric b { display: block; font-size: 24px; margin-top: 8px; }
    .dropzone {
      border: 1px dashed var(--line-strong);
      border-radius: 8px;
      min-height: 156px;
      display: grid;
      grid-template-columns: 120px 1fr;
      gap: 18px;
      align-items: center;
      padding: 18px;
      background: white;
    }
    .folder-sync {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      background: #fbfcfb;
      display: grid;
      gap: 12px;
    }
    .folder-form {
      display: grid;
      grid-template-columns: minmax(240px,1fr) auto auto auto;
      gap: 10px;
      align-items: end;
    }
    .workflow-status {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .profile-form {
      display: grid;
      grid-template-columns: minmax(260px,1fr) auto auto;
      gap: 10px;
      align-items: end;
    }
    details.debug-details {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fbfcfb;
      padding: 12px;
    }
    details.debug-details summary {
      cursor: pointer;
      font-weight: 700;
    }
    .sheets { width: 100px; height: 100px; position: relative; }
    .sheet {
      width: 74px;
      height: 94px;
      border: 1px solid var(--line-strong);
      border-radius: 6px;
      background: white;
      position: absolute;
      box-shadow: 0 8px 18px rgba(31,42,36,0.08);
    }
    .sheet:nth-child(1) { left: 2px; top: 6px; transform: rotate(-7deg); }
    .sheet:nth-child(2) { left: 22px; top: 1px; transform: rotate(3deg); }
    .sheet:nth-child(3) { left: 41px; top: 8px; transform: rotate(8deg); }
    .sheet::before, .sheet::after {
      content: "";
      position: absolute;
      left: 12px;
      right: 12px;
      height: 6px;
      border-radius: 99px;
      background: var(--line);
    }
    .sheet::before { top: 22px; }
    .sheet::after { top: 38px; right: 24px; }
    .list { display: grid; gap: 8px; }
    .item {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 11px;
      background: white;
      display: grid;
      gap: 8px;
    }
    .item-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      align-items: start;
    }
    .badge {
      min-height: 24px;
      border-radius: 999px;
      padding: 2px 8px;
      display: inline-flex;
      align-items: center;
      width: fit-content;
      color: var(--muted);
      background: var(--soft);
      border: 1px solid var(--line);
      font-size: 12px;
      white-space: nowrap;
    }
    .badge.green { color: var(--green); background: var(--green-soft); border-color: rgba(35,122,87,0.25); }
    .badge.blue { color: var(--blue); background: var(--blue-soft); border-color: rgba(38,106,153,0.25); }
    .badge.amber { color: var(--amber); background: var(--amber-soft); border-color: rgba(150,105,18,0.25); }
    .badge.red { color: var(--red); background: var(--red-soft); border-color: rgba(163,58,51,0.25); }
    .empty {
      border: 1px dashed var(--line-strong);
      border-radius: 8px;
      color: var(--muted);
      padding: 16px;
      text-align: center;
      background: #fbfcfb;
    }
    textarea, input, select {
      width: 100%;
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      background: white;
      color: var(--ink);
      padding: 10px;
    }
    textarea { min-height: 190px; resize: vertical; }
    .rule-editor textarea {
      min-height: 260px;
      font-family: var(--mono);
      font-size: 13px;
      line-height: 1.5;
    }
    .form-grid { display: grid; grid-template-columns: minmax(0,1fr) 160px auto; gap: 10px; align-items: end; }
    .notice {
      border: 1px solid rgba(38,106,153,0.24);
      border-radius: 8px;
      padding: 12px;
      background: var(--blue-soft);
      color: #1e4158;
      margin-bottom: 14px;
    }
    .tab { display: none; }
    .tab.active { display: block; }
    .bottom-nav {
      position: fixed;
      left: 50%;
      bottom: 18px;
      transform: translateX(-50%);
      background: rgba(255,255,255,0.92);
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 8px;
      display: flex;
      gap: 8px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(12px);
      z-index: 10;
    }
    .bottom-nav .btn { border-radius: 999px; min-height: 34px; }
    .bottom-nav .btn.active { background: var(--charcoal); color: white; border-color: var(--charcoal); }
    pre {
      max-height: 360px;
      overflow: auto;
      padding: 12px;
      border-radius: 8px;
      background: #151b18;
      color: #dce7df;
      font: 12px/1.45 var(--mono);
    }
    .rule-source-preview {
      max-height: 220px;
      margin: 0;
      white-space: pre-wrap;
      color: var(--ink);
      background: #fbfcfb;
      border: 1px solid var(--line);
    }
    .review-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: white;
      padding: 14px;
      display: grid;
      gap: 12px;
    }
    .review-card.needs-action { border-color: rgba(150,105,18,0.28); }
    .review-card.accepted { border-color: rgba(35,122,87,0.26); background: #fbfdfb; }
    .review-top {
      display: grid;
      grid-template-columns: minmax(0,1fr) auto;
      gap: 14px;
      align-items: start;
    }
    .review-copy { display: grid; gap: 8px; }
    .review-title { font-size: 15px; line-height: 1.25; }
    .review-body {
      color: var(--ink);
      font-size: 14px;
      line-height: 1.48;
      white-space: pre-wrap;
    }
    .review-meta {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .review-actions {
      display: flex;
      gap: 10px;
      align-items: center;
      justify-content: flex-end;
      flex-wrap: wrap;
    }
    .review-evidence {
      border-top: 1px solid var(--line);
      padding-top: 10px;
      color: var(--muted);
      display: grid;
      gap: 5px;
      font-size: 12px;
    }
    .context-form {
      display: grid;
      grid-template-columns: minmax(0,1fr) 130px auto;
      gap: 10px;
      align-items: end;
    }
    .context-form textarea {
      min-height: 96px;
    }
    .context-result {
      display: grid;
      gap: 12px;
    }
    .context-summary {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .context-entry-body {
      margin-top: 6px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }
    @media (max-width: 1100px) {
      .workspace, .setup-strip { grid-template-columns: 1fr; }
      .strip-head { border-right: 0; border-bottom: 1px solid var(--line); }
      .steps { grid-template-columns: repeat(2,minmax(0,1fr)); }
      .metric-row { grid-template-columns: repeat(2,minmax(0,1fr)); }
    }
    @media (max-width: 680px) {
      .topbar {
        align-items: flex-start;
        flex-direction: column;
        padding: 12px 14px;
        position: static;
      }
      .app {
        width: calc(100vw - 24px);
        margin-top: 14px;
        padding-bottom: 0;
      }
      .steps, .metric-row, .form-grid, .dropzone, .context-form { grid-template-columns: 1fr; }
      .folder-form, .profile-form { grid-template-columns: 1fr; }
      .review-top { grid-template-columns: 1fr; }
      .review-actions { justify-content: flex-start; }
      .bottom-nav {
        position: sticky;
        top: 0;
        bottom: auto;
        left: auto;
        transform: none;
        width: 100%;
        border-radius: 0;
        border-left: 0;
        border-right: 0;
        overflow-x: auto;
        justify-content: space-between;
      }
      .bottom-nav .btn { flex: 1 0 auto; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <div class="mark">CT</div>
      <div>
        <h1>ContextTrail Setup</h1>
        <p class="subtle" id="cwd">Loading workspace...</p>
      </div>
    </div>
    <div class="top-actions">
      <span class="badge amber" id="readinessBadge">loading</span>
      <button class="btn" id="syncButton" title="Pull changed files from saved folders and update the local index.">Sync Folders</button>
      <button class="btn primary" id="refreshButton" title="Reload this screen from the local ContextTrail state.">Reload UI</button>
    </div>
  </header>

  <nav class="bottom-nav" aria-label="Sections">
    <button class="btn active" data-tab-button="documents">Documents</button>
    <button class="btn" data-tab-button="rules">Rules</button>
    <button class="btn" data-tab-button="review">Review</button>
    <button class="btn" data-tab-button="profiles">Profiles</button>
  </nav>

  <main class="app">
    <section class="setup-strip">
      <div class="strip-head">
        <h2>Setup State</h2>
        <p class="subtle" id="setupSuggestion">Reading local setup state.</p>
      </div>
      <div class="steps" id="steps"></div>
    </section>

    <section class="tab active" data-tab="documents">
      <div class="workspace">
        <div class="stack">
          <section class="panel">
            <div class="panel-head">
              <div>
                <h2>Documents</h2>
                <p class="subtle">Primary corpus for task evidence.</p>
              </div>
              <button class="btn" id="importDocsButton">Import docs folder</button>
            </div>
            <div class="panel-body">
              <div id="workflowStatus" class="notice workflow-status"></div>
              <div class="metric-row">
                <div class="metric"><span class="subtle">Sources</span><b id="metricSources">0</b></div>
                <div class="metric"><span class="subtle">Chunks</span><b id="metricChunks">0</b></div>
                <div class="metric"><span class="subtle">Rules</span><b id="metricRules">0</b></div>
                <div class="metric"><span class="subtle">Suggestions</span><b id="metricSuggestions">0</b></div>
              </div>
              <div class="dropzone">
                <div class="sheets" aria-hidden="true"><div class="sheet"></div><div class="sheet"></div><div class="sheet"></div></div>
                <div>
                  <h2>Add work documents first</h2>
                  <p class="subtle">Upload text documents, or sync a folder with Markdown, Word, PDF, and text files.</p>
                  <div style="height:12px"></div>
                  <div class="row">
                    <input id="docFiles" type="file" multiple accept=".md,.txt,.markdown,.docx,.pdf,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
                    <button class="btn primary" id="uploadDocsButton">Upload Documents</button>
                  </div>
                </div>
              </div>
              <div style="height:14px"></div>
              <div class="folder-sync">
                <div>
                  <h2>Synced Folder</h2>
                  <p class="subtle">Save a local folder once, then use Sync to pull new or changed documents.</p>
                </div>
                <div class="folder-form">
                  <input id="docSourcePath" placeholder="/Users/thomas/Documents/client-folder/docs">
                  <button class="btn" id="browseDocSourceButton">Browse</button>
                  <button class="btn" id="saveDocSourceButton">Add Folder</button>
                  <button class="btn primary" id="replaceDocSourceButton">Use Only This Folder</button>
                </div>
                <details style="margin-top:10px">
                  <summary class="subtle">Advanced file filter</summary>
                  <div style="height:8px"></div>
                  <input id="docSourceGlob" placeholder="**/*.{md,markdown,txt,docx,pdf}">
                </details>
                <div id="docSourcesList" class="list"></div>
              </div>
              <div style="height:14px"></div>
              <div id="sourcesList" class="list"></div>
            </div>
          </section>
          <section class="panel">
            <div class="panel-head">
              <div>
                <h2>Try Prompt</h2>
                <p class="subtle">Preview the context pack an agent would receive.</p>
              </div>
            </div>
            <div class="panel-body">
              <div class="context-form">
                <textarea id="contextPrompt" placeholder="Assess whether the water-damage claim is ready for coverage review."></textarea>
                <select id="contextBudget">
                  <option value="default">Standard</option>
                  <option value="small">Small</option>
                  <option value="large">Deep</option>
                </select>
                <button class="btn primary" id="contextPreviewButton">Assemble Context</button>
              </div>
              <div style="height:14px"></div>
              <div id="contextPreviewResult" class="context-result">
                <div class="empty">No prompt run yet.</div>
              </div>
            </div>
          </section>
        </div>
        <aside class="panel">
          <div class="panel-head">
            <div>
              <h2>Agent Preview</h2>
              <p class="subtle">Readiness and handoff state.</p>
            </div>
          </div>
          <div class="panel-body" id="agentPreview"></div>
        </aside>
      </div>
    </section>

    <section class="tab" data-tab="rules">
      <div class="workspace">
        <div class="stack">
          <section class="panel">
            <div class="panel-head">
              <div>
                <h2>Agent Rules</h2>
                <p class="subtle">Durable operating manual, separate from evidence docs.</p>
              </div>
              <span class="badge blue">soul.md style</span>
            </div>
            <div class="panel-body">
              <div class="notice"><strong>Rules are not evidence.</strong><br>They shape authority, retries, citations, and missing-context behavior before the agent receives a context pack.</div>
              <div class="rule-editor">
                <input id="ruleTitle" placeholder="Rule title">
                <div style="height:10px"></div>
                <textarea id="ruleBody" placeholder="Example: signed source documents outrank drafts. Missing-context claims require adequate search before reporting absence."></textarea>
                <div style="height:10px"></div>
                <div class="form-grid">
                  <input id="ruleProject" placeholder="Project scope">
                  <select id="ruleLayer">
                    <option value="project">Project</option>
                    <option value="team">Team</option>
                    <option value="company">Company</option>
                    <option value="module">Module</option>
                  </select>
                  <button class="btn primary" id="saveRuleButton">Save Rule</button>
                </div>
              </div>
              <div style="height:14px"></div>
              <div class="row">
                <input id="ruleSourceFiles" type="file" multiple accept=".md,.txt,.markdown,text/plain,text/markdown">
                <button class="btn" id="uploadRuleSourcesButton">Upload Rule Sources</button>
              </div>
            </div>
          </section>
          <section class="panel">
            <div class="panel-head">
              <div>
                <h2>Rule Sources</h2>
                <p class="subtle">Stored outside the evidence corpus.</p>
              </div>
            </div>
            <div class="panel-body" id="ruleSourcesList"></div>
          </section>
        </div>
        <aside class="panel">
          <div class="panel-head">
            <div>
              <h2>Runtime Rules</h2>
              <p class="subtle">Accepted instructions sent before assembly.</p>
            </div>
          </div>
          <div class="panel-body" id="rulesList"></div>
        </aside>
      </div>
    </section>

    <section class="tab" data-tab="review">
      <div class="workspace">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>Suggestions</h2>
              <p class="subtle">Review before promotion into agent rules.</p>
            </div>
            <button class="btn" id="bootstrapButton">Find Suggestions</button>
          </div>
          <div class="panel-body" id="suggestionsList"></div>
        </section>
        <aside class="panel">
          <div class="panel-head">
            <div>
              <h2>Review Summary</h2>
              <p class="subtle">Open suggestions and accepted rules.</p>
            </div>
          </div>
          <div class="panel-body" id="inboxSummary"></div>
        </aside>
      </div>
    </section>

    <section class="tab" data-tab="profiles">
      <div class="workspace">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>Task Profiles</h2>
              <p class="subtle">Named snapshots of folders and Agent Rules.</p>
            </div>
          </div>
          <div class="panel-body">
            <div class="notice"><strong>Profile choices</strong><br>Save Current captures the visible folders and Agent Rules. Start Empty creates a clean work packet with no active documents or rules.</div>
            <div class="profile-form">
              <input id="profileName" placeholder="Claim review, vendor onboarding, QBR prep">
              <button class="btn primary" id="saveProfileButton">Save Current</button>
              <button class="btn" id="emptyProfileButton">Start Empty</button>
            </div>
            <div style="height:14px"></div>
            <div id="profilesList" class="list"></div>
          </div>
        </section>
        <aside class="panel">
          <div class="panel-head">
            <div>
              <h2>System</h2>
              <p class="subtle">Agent connection and debug state.</p>
            </div>
          </div>
          <div class="panel-body">
            <div id="mcpState"></div>
            <div style="height:12px"></div>
            <details class="debug-details">
              <summary>Raw State</summary>
              <pre id="stateJson">{}</pre>
            </details>
          </div>
        </aside>
      </div>
    </section>
  </main>

  <script>
    var state = null;
    var activeTab = "documents";
    var $ = function(selector) { return document.querySelector(selector); };
    var $$ = function(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); };

    function escapeHtml(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    async function api(path, options) {
      var response = await fetch(path, Object.assign({
        headers: { "content-type": "application/json" }
      }, options || {}));
      var json = await response.json();
      if (!response.ok) throw new Error(json.error || "Request failed");
      return json;
    }

    async function loadState() {
      $("#readinessBadge").textContent = "loading";
      state = await api("/api/state");
      render();
    }

    function render() {
      if (!state) return;
      $("#cwd").textContent = state.cwd;
      var suggestion = state.setup.suggestion || {};
      $("#setupSuggestion").textContent = suggestion.message || "Setup state ready.";
      $("#readinessBadge").textContent = suggestion.row_name || "ready";
      $("#readinessBadge").className = "badge " + (state.suggestions.length > 0 ? "amber" : "green");
      renderSteps();
      renderDocuments();
      renderAgentPreview();
      renderRules();
      renderReview();
      renderProfiles();
      renderTabs();
    }

    function renderSteps() {
      var dims = state.setup.dimensions;
      var openSuggestions = state.suggestions.length;
      var items = [
        ["Documents", dims.corpus_coverage.score, state.sources.length + " sources"],
        ["Agent Rules", dims.card_coverage.score, state.rules.length + " rules"],
        ["Review", openSuggestions > 0 ? "partial" : "confident", openSuggestions + " to review"],
        ["Profiles", state.task_profiles.length > 0 ? "confident" : "partial", state.task_profiles.length + " saved"]
      ];
      $("#steps").innerHTML = items.map(function(item, index) {
        return '<div class="step ' + (index === tabIndex(activeTab) ? 'active' : '') + '">' +
          '<div class="step-icon">' + (index + 1) + '</div>' +
          '<div><strong>' + escapeHtml(item[0]) + '</strong><span class="subtle">' + escapeHtml(item[2]) + '</span></div>' +
          '<span class="badge ' + bandClass(item[1]) + '">' + escapeHtml(item[1]) + '</span>' +
        '</div>';
      }).join("");
    }

    function renderDocuments() {
      var chunks = state.sources.reduce(function(total, source) { return total + source.chunk_count; }, 0);
      var activeProfile = state.task_profiles.find(function(profile) { return profile.id === state.active_task_profile_id; });
      $("#workflowStatus").innerHTML = activeProfile
        ? '<div><strong>Workflow</strong><p class="subtle">' + escapeHtml(activeProfile.name) + '</p></div><span class="badge green">active</span>'
        : '<div><strong>Workflow</strong><p class="subtle">All Documents</p></div><span class="badge amber">no active workflow</span>';
      $("#metricSources").textContent = state.sources.length;
      $("#metricChunks").textContent = chunks;
      $("#metricRules").textContent = state.rules.length;
      $("#metricSuggestions").textContent = state.suggestions.length;
      $("#docSourcesList").innerHTML = state.document_sources.length ? state.document_sources.map(function(source) {
        return '<div class="item"><div class="item-row"><div><strong>' + escapeHtml(source.path) + '</strong><div class="subtle">' + escapeHtml(source.glob) + '</div></div><span class="badge ' + (source.exists ? 'green' : 'amber') + '">' + (source.exists ? 'ready' : 'missing') + '</span></div></div>';
      }).join("") : '<div class="empty">No synced folder saved yet.</div>';
      $("#sourcesList").innerHTML = state.sources.length ? state.sources.map(function(source) {
        var extraction = source.extraction || {};
        var badge = extractionBadge(extraction.status || (source.chunk_count > 0 ? "indexed" : "failed"));
        var details = [
          source.scope_summary,
          source.chunk_count + " chunks",
          extraction.method || "text",
          extraction.quality ? "quality " + extraction.quality : ""
        ].filter(Boolean).join(" · ");
        var warning = extraction.warnings && extraction.warnings.length
          ? '<div class="subtle">' + escapeHtml(snippet(extraction.warnings.join(" "), 180)) + '</div>'
          : "";
        return '<div class="item"><div class="item-row"><div><strong>' + escapeHtml(source.source_path) + '</strong><div class="subtle">' + escapeHtml(details) + '</div>' + warning + '</div><span class="badge ' + badge.cls + '">' + escapeHtml(badge.label) + '</span></div></div>';
      }).join("") : '<div class="empty">No imported documents yet.</div>';
    }

    function extractionBadge(status) {
      if (status === "indexed") return { label: "indexed", cls: "green" };
      if (status === "parsed_with_warnings") return { label: "warnings", cls: "amber" };
      if (status === "layout_sensitive") return { label: "layout-sensitive", cls: "amber" };
      if (status === "needs_ocr") return { label: "needs OCR", cls: "red" };
      if (status === "failed") return { label: "failed", cls: "red" };
      return { label: String(status || "unknown"), cls: "blue" };
    }

    function renderAgentPreview() {
      var dims = state.setup.dimensions;
      $("#agentPreview").innerHTML =
        '<div class="item"><strong>Corpus</strong><span class="badge ' + bandClass(dims.corpus_coverage.score) + '">' + dims.corpus_coverage.score + '</span><p class="subtle">' + state.sources.length + ' imported source(s)</p></div>' +
        '<div style="height:8px"></div>' +
        '<div class="item"><strong>Rules</strong><span class="badge ' + bandClass(dims.card_coverage.score) + '">' + dims.card_coverage.score + '</span><p class="subtle">' + state.rules.length + ' accepted rule(s)</p></div>' +
        '<div style="height:8px"></div>' +
        '<div class="item"><strong>Next</strong><p class="subtle">' + escapeHtml((state.setup.suggestion || {}).message || "Ready") + '</p></div>';
    }

    function renderRules() {
      $("#rulesList").innerHTML = state.rules.length ? state.rules.map(function(rule) {
        return '<div class="item"><div class="item-row"><div><strong>' + escapeHtml(rule.title) + '</strong><p class="subtle">' + escapeHtml(rule.body) + '</p><div class="row"><span class="badge green">accepted</span><span class="badge blue">' + escapeHtml(rule.scope_summary) + '</span><span class="badge">' + rule.token_count + ' tokens</span></div></div></div></div>';
      }).join("") : '<div class="empty">No accepted rules yet.</div>';
      $("#ruleSourcesList").innerHTML = state.rule_sources.length ? '<div class="list">' + state.rule_sources.map(function(source) {
        return '<div class="item"><div class="item-row"><div><strong>' + escapeHtml(source.display_name || source.name) + '</strong><p class="subtle">' + escapeHtml(source.path) + ' · ' + source.size + ' bytes</p></div><button class="btn" data-load-rule-source="' + escapeHtml(source.path) + '">Load Into Editor</button></div><pre class="rule-source-preview">' + escapeHtml(source.content) + '</pre></div>';
      }).join("") + '</div>' : '<div class="empty">No rule sources uploaded.</div>';
    }

    function renderReview() {
      $("#inboxSummary").innerHTML =
        '<div class="item"><strong>Open Suggestions</strong><b>' + state.suggestions.length + '</b></div>' +
        '<div style="height:8px"></div>' +
        '<div class="item"><strong>Accepted Rules</strong><b>' + state.rules.length + '</b></div>' +
        '<div style="height:8px"></div>' +
        '<div class="item"><strong>Cleared</strong><b>' + (state.inbox.status_counts.rejected + state.inbox.status_counts.answered) + '</b></div>';
      $("#suggestionsList").innerHTML = state.suggestions.length
        ? state.suggestions.map(renderSuggestionCard).join("")
        : '<div class="empty">No open suggestions. Accepted items have moved into Agent Rules.</div>';
    }

    function renderSuggestionCard(item) {
      var kind = suggestionKind(item);
      var status = suggestionStatusLabel(item);
      var actions = suggestionActions(item);
      var evidence = suggestionEvidence(item);
      var className = "review-card " + (item.status === "pending" ? "needs-action" : item.status);
      return '<div class="' + className + '">' +
        '<div class="review-top">' +
          '<div class="review-copy">' +
            '<div class="review-meta"><span class="badge blue">' + escapeHtml(kind) + '</span><span class="badge ' + statusClass(item.status) + '">' + escapeHtml(status) + '</span></div>' +
            '<strong class="review-title">' + escapeHtml(cleanSuggestionTitle(item)) + '</strong>' +
            '<div class="review-body">' + escapeHtml(cleanSuggestionBody(item)) + '</div>' +
          '</div>' +
          '<div class="review-actions">' + actions + '</div>' +
        '</div>' +
        evidence +
      '</div>';
    }

    function suggestionKind(item) {
      if (item.review_type === "candidate_card") return "Proposed Agent Rule";
      if (item.review_type === "clarification_need") return "Needs Guidance";
      return item.review_type;
    }

    function suggestionStatusLabel(item) {
      if (item.status === "pending" && item.review_type === "candidate_card") return "Review";
      if (item.status === "pending" && item.review_type === "clarification_need") return "Answer";
      if (item.status === "accepted") return "Accepted";
      if (item.status === "rejected") return "Rejected";
      if (item.status === "answered") return "Answered";
      return item.status;
    }

    function cleanSuggestionTitle(item) {
      return String(item.title || "").replace(/^Clarify:\\s*/i, "");
    }

    function cleanSuggestionBody(item) {
      var body = String(item.body || "").trim();
      if (item.review_type === "clarification_need") {
        var parts = body.split(/\\n\\s*\\n/).map(function(part) { return part.trim(); }).filter(Boolean);
        return parts[parts.length - 1] || body;
      }
      return body;
    }

    function suggestionActions(item) {
      if (item.status !== "pending") {
        return '<span class="badge ' + statusClass(item.status) + '">' + escapeHtml(suggestionStatusLabel(item)) + '</span>';
      }
      if (item.review_type === "candidate_card") {
        return '<button class="btn green" data-accept="' + escapeHtml(item.id) + '">Accept Rule</button><button class="btn danger" data-reject="' + escapeHtml(item.id) + '">Reject</button>';
      }
      if (item.review_type === "clarification_need") {
        var choices = item.choices || [];
        if (!choices.length) return '<span class="badge amber">Needs answer</span>';
        return choices.map(function(choice) {
          var label = choice.id === "constraint" ? "Make Rule" : choice.id === "ignore" ? "Ignore" : choice.label;
          var cls = choice.id === "constraint" ? "btn green" : "btn";
          return '<button class="' + cls + '" data-answer-choice="' + escapeHtml(item.id) + '" data-choice-id="' + escapeHtml(choice.id) + '">' + escapeHtml(label) + '</button>';
        }).join("");
      }
      return '<span class="badge amber">Needs decision</span>';
    }

    function suggestionEvidence(item) {
      if (!item.supporting_chunks || !item.supporting_chunks.length) return "";
      return '<div class="review-evidence"><strong>Source evidence</strong>' + item.supporting_chunks.map(function(chunk) {
        var heading = (chunk.heading_path || []).join(" > ");
        return '<div>' + escapeHtml(chunk.source_path) + (heading ? ' · ' + escapeHtml(heading) : '') + '</div>';
      }).join("") + '</div>';
    }

    function renderContextPreview(pack) {
      var readiness = pack.task_readiness || {};
      var recovery = pack.recovery_plan || {};
      var locked = pack.locked || [];
      var ranked = pack.ranked || [];
      var warnings = pack.warnings || [];
      var summary =
        '<div class="context-summary">' +
          '<span class="badge ' + bandClass(pack.coverage_confidence) + '">' + escapeHtml(pack.coverage_confidence || "unknown") + '</span>' +
          '<span class="badge ' + readinessClass(readiness.pack_readiness) + '">' + escapeHtml(readiness.pack_readiness || "unknown") + '</span>' +
          '<span class="badge">rules ' + locked.length + '</span>' +
          '<span class="badge">sources ' + ranked.length + '</span>' +
          '<span class="badge">' + escapeHtml(pack.budget ? pack.budget.used + "/" + pack.budget.requested + " tokens" : "tokens n/a") + '</span>' +
        '</div>';
      var next = recovery.hint
        ? '<div class="item"><strong>Recovery</strong><p class="subtle">' + escapeHtml(recovery.hint) + '</p></div>'
        : "";
      var warningHtml = warnings.length
        ? '<div class="item"><strong>Warnings</strong>' + warnings.map(function(w) { return '<p class="subtle">' + escapeHtml(w.kind + ": " + w.message + (w.hint ? " " + w.hint : "")) + '</p>'; }).join("") + '</div>'
        : "";
      var lockedHtml = locked.length
        ? '<div class="item"><strong>Agent Rules Included</strong>' + locked.map(function(entry) {
            return '<div class="context-entry-body"><b>' + escapeHtml(entry.id) + '</b> · ' + escapeHtml(entry.card_type) + ' · ' + entry.tokens + ' tokens<br>' + escapeHtml(snippet(entry.body, 220)) + '</div>';
          }).join("") + '</div>'
        : "";
      var rankedHtml = ranked.length
        ? '<div class="item"><strong>Sources Retrieved</strong>' + ranked.map(function(entry, index) {
            var label = entry.source_path || entry.contexttrail || entry.id;
            return '<div class="context-entry-body"><b>' + (index + 1) + '. ' + escapeHtml(label) + '</b> · score ' + Number(entry.score || 0).toFixed(3) + ' · ' + entry.tokens + ' tokens<br>' + escapeHtml(snippet(entry.body, 260)) + '</div>';
          }).join("") + '</div>'
        : '<div class="item"><strong>Sources Retrieved</strong><p class="subtle">No ranked sources returned.</p></div>';
      var rendered = pack.rendered_text
        ? '<details class="debug-details"><summary>Rendered Context Pack</summary><pre>' + escapeHtml(pack.rendered_text) + '</pre></details>'
        : "";
      $("#contextPreviewResult").innerHTML = summary + next + warningHtml + lockedHtml + rankedHtml + rendered;
    }

    function snippet(value, limit) {
      var text = String(value || "").replace(/\\s+/g, " ").trim();
      return text.length > limit ? text.slice(0, limit - 1) + "..." : text;
    }

    function readinessClass(value) {
      if (value === "ready") return "green";
      if (value === "partial") return "amber";
      if (value === "retry_required" || value === "blocked") return "red";
      return "blue";
    }

    function renderProfiles() {
      $("#profilesList").innerHTML = state.task_profiles.length ? state.task_profiles.map(function(profile) {
        var sources = profile.document_sources.length ? profile.document_sources.map(function(source) {
          return '<span class="badge">' + escapeHtml(source.path) + '</span>';
        }).join("") : '<span class="badge amber">no folders</span>';
        var rules = profile.rule_titles.length ? profile.rule_titles.map(function(rule) {
          return '<span class="badge blue">' + escapeHtml(rule.title) + '</span>';
        }).join("") : '<span class="badge">no rules</span>';
        var action = profile.active
          ? '<span class="badge green">active</span>'
          : '<button class="btn" data-apply-profile="' + escapeHtml(profile.id) + '">Apply</button>';
        return '<div class="item"><div class="item-row"><div><strong>' + escapeHtml(profile.name) + '</strong><p class="subtle">' + profile.document_sources.length + ' folder(s) · ' + profile.rule_ids.length + ' rule(s)</p><div class="row">' + sources + '</div><div class="row">' + rules + '</div></div><div>' + action + '</div></div></div>';
      }).join("") : '<div class="empty">No task profiles saved yet.</div>';
      $("#stateJson").textContent = JSON.stringify(state, null, 2);
      $("#mcpState").innerHTML = '<div class="item"><strong>Codex</strong><span class="badge ' + (state.mcp.codex.installed ? 'green' : 'amber') + '">' + (state.mcp.codex.installed ? 'installed' : 'not installed') + '</span><p class="subtle">' + escapeHtml((state.mcp.codex.hints || []).join(" ")) + '</p></div>';
    }

    function renderTabs() {
      $$(".tab").forEach(function(tab) { tab.classList.toggle("active", tab.dataset.tab === activeTab); });
      $$("[data-tab-button]").forEach(function(btn) { btn.classList.toggle("active", btn.dataset.tabButton === activeTab); });
    }

    function bandClass(value) {
      if (value === "confident") return "green";
      if (value === "partial") return "amber";
      if (value === "low") return "red";
      return "blue";
    }

    function statusClass(value) {
      if (value === "accepted" || value === "answered") return "green";
      if (value === "rejected") return "red";
      return "amber";
    }

    function tabIndex(tab) {
      return ["documents", "rules", "review", "profiles"].indexOf(tab);
    }

    async function readFiles(input) {
      var files = Array.prototype.slice.call(input.files || []);
      return Promise.all(files.map(function(file) {
        return new Promise(function(resolve, reject) {
          var reader = new FileReader();
          reader.onerror = function() { reject(reader.error || new Error("Could not read file")); };
          reader.onload = function() {
            var result = String(reader.result || "");
            resolve({
              name: file.name,
              data_base64: result.indexOf(",") >= 0 ? result.split(",")[1] : result,
              content_type: file.type || ""
            });
          };
          reader.readAsDataURL(file);
        });
      }));
    }

    $$("[data-tab-button]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        activeTab = btn.dataset.tabButton;
        render();
      });
    });
    document.addEventListener("click", async function(event) {
      var accept = event.target.closest("[data-accept]");
      var reject = event.target.closest("[data-reject]");
      var loadRuleSource = event.target.closest("[data-load-rule-source]");
      var applyProfile = event.target.closest("[data-apply-profile]");
      var answerChoice = event.target.closest("[data-answer-choice]");
      try {
        if (loadRuleSource) {
          var sourcePath = loadRuleSource.dataset.loadRuleSource;
          var source = state.rule_sources.find(function(item) { return item.path === sourcePath; });
          if (source) {
            $("#ruleTitle").value = (source.display_name || source.name).replace(/\\.[^.]+$/, "");
            $("#ruleBody").value = source.content;
          }
          return;
        }
        if (accept) {
          await api("/api/suggestions/" + encodeURIComponent(accept.dataset.accept) + "/accept", { method: "POST", body: "{}" });
          await loadState();
          return;
        }
        if (answerChoice) {
          await api("/api/suggestions/" + encodeURIComponent(answerChoice.dataset.answerChoice) + "/answer", { method: "POST", body: JSON.stringify({
            choice_id: answerChoice.dataset.choiceId
          }) });
          await loadState();
          return;
        }
        if (applyProfile) {
          await api("/api/task-profiles/" + encodeURIComponent(applyProfile.dataset.applyProfile) + "/apply", { method: "POST", body: "{}" });
          await loadState();
          return;
        }
        if (reject) {
          await api("/api/suggestions/" + encodeURIComponent(reject.dataset.reject) + "/reject", { method: "POST", body: "{}" });
          await loadState();
          return;
        }
      } catch (err) {
        alert(err.message);
      }
    });
    $("#refreshButton").addEventListener("click", loadState);
    $("#syncButton").addEventListener("click", async function() {
      await api("/api/sync", { method: "POST", body: JSON.stringify({ check: false }) });
      await loadState();
    });
    $("#importDocsButton").addEventListener("click", async function() {
      await api("/api/documents/import", { method: "POST", body: JSON.stringify({ patterns: ["docs/**/*.{md,markdown,txt,docx,pdf}"] }) });
      await loadState();
    });
    $("#browseDocSourceButton").addEventListener("click", async function() {
      try {
        var result = await api("/api/fs/choose-folder");
        if (result.cancelled) return;
        if (result.path) $("#docSourcePath").value = result.path;
      } catch (err) {
        alert("Could not open the native folder picker. You can still paste a folder path manually. " + err.message);
      }
    });
    $("#saveDocSourceButton").addEventListener("click", async function() {
      await api("/api/document-sources", { method: "POST", body: JSON.stringify({
        path: $("#docSourcePath").value,
        glob: $("#docSourceGlob").value
      }) });
      $("#docSourcePath").value = "";
      await loadState();
    });
    $("#replaceDocSourceButton").addEventListener("click", async function() {
      await api("/api/document-sources/replace", { method: "POST", body: JSON.stringify({
        path: $("#docSourcePath").value,
        glob: $("#docSourceGlob").value
      }) });
      $("#docSourcePath").value = "";
      await loadState();
    });
    $("#contextPreviewButton").addEventListener("click", async function() {
      var task = $("#contextPrompt").value.trim();
      if (!task) {
        $("#contextPreviewResult").innerHTML = '<div class="empty">Enter a prompt first.</div>';
        return;
      }
      $("#contextPreviewButton").disabled = true;
      $("#contextPreviewButton").textContent = "Assembling...";
      $("#contextPreviewResult").innerHTML = '<div class="empty">Assembling context...</div>';
      try {
        var pack = await api("/api/context/preview", { method: "POST", body: JSON.stringify({
          task: task,
          budget: $("#contextBudget").value
        }) });
        renderContextPreview(pack);
      } catch (err) {
        $("#contextPreviewResult").innerHTML = '<div class="empty">' + escapeHtml(err.message) + '</div>';
      } finally {
        $("#contextPreviewButton").disabled = false;
        $("#contextPreviewButton").textContent = "Assemble Context";
      }
    });
    $("#saveProfileButton").addEventListener("click", async function() {
      await api("/api/task-profiles", { method: "POST", body: JSON.stringify({
        name: $("#profileName").value,
        mode: "current"
      }) });
      $("#profileName").value = "";
      activeTab = "profiles";
      await loadState();
    });
    $("#emptyProfileButton").addEventListener("click", async function() {
      await api("/api/task-profiles", { method: "POST", body: JSON.stringify({
        name: $("#profileName").value,
        mode: "empty"
      }) });
      $("#profileName").value = "";
      activeTab = "profiles";
      await loadState();
    });
    $("#uploadDocsButton").addEventListener("click", async function() {
      var files = await readFiles($("#docFiles"));
      await api("/api/documents/upload", { method: "POST", body: JSON.stringify({ files: files }) });
      $("#docFiles").value = "";
      await loadState();
    });
    $("#saveRuleButton").addEventListener("click", async function() {
      await api("/api/rules", { method: "POST", body: JSON.stringify({
        title: $("#ruleTitle").value,
        body: $("#ruleBody").value,
        scope: { layer: $("#ruleLayer").value, project: $("#ruleProject").value }
      }) });
      $("#ruleTitle").value = "";
      $("#ruleBody").value = "";
      await loadState();
    });
    $("#uploadRuleSourcesButton").addEventListener("click", async function() {
      var files = await readFiles($("#ruleSourceFiles"));
      await api("/api/rule-sources/upload", { method: "POST", body: JSON.stringify({ files: files }) });
      $("#ruleSourceFiles").value = "";
      await loadState();
    });
    $("#bootstrapButton").addEventListener("click", async function() {
      await api("/api/suggestions/bootstrap", { method: "POST", body: "{}" });
      await loadState();
    });
    loadState().catch(function(err) {
      $("#readinessBadge").textContent = "error";
      alert(err.message);
    });
  </script>
</body>
</html>`;
