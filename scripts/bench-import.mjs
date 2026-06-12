/**
 * bench:import — times a full `runImport` over a synthetic PDF corpus.
 *
 * Usage:
 *   npm run bench:import            # 300 PDFs (default)
 *   npm run bench:import -- 1000    # custom corpus size
 *
 * Generates N minimal single-page PDFs in a tempdir, runs the compiled
 * import pipeline against them, and prints total time plus files/sec.
 * Requires a fresh `npm run build` (the npm script does this for you).
 * Not part of CI or `npm test` — this is a manual perf harness.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const importJsPath = fileURLToPath(new URL("../dist/cli/import.js", import.meta.url));
if (!existsSync(importJsPath)) {
  console.error("dist/cli/import.js not found — run `npm run build` first.");
  process.exit(1);
}
const { runImport } = await import(importJsPath);

const count = Number.parseInt(process.argv[2] ?? "300", 10);
if (!Number.isInteger(count) || count <= 0) {
  console.error(`invalid corpus size: ${process.argv[2]}`);
  process.exit(1);
}

/**
 * Minimal single-page PDF with a real text layer. Mirrors the fixture
 * generator used by src/cli/import.test.ts (replicated on purpose — the
 * bench must not import from test files).
 */
function minimalPdf(text) {
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
  const stream = `BT /F1 24 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += object;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "binary");
}

const cwd = mkdtempSync(join(tmpdir(), "contexttrail-bench-import-"));
try {
  mkdirSync(join(cwd, "docs"), { recursive: true });
  for (let i = 0; i < count; i++) {
    writeFileSync(
      join(cwd, "docs", `doc-${String(i).padStart(5, "0")}.pdf`),
      minimalPdf(`Benchmark document ${i}: the refund invoice total is $${1000 + i}.`),
    );
  }
  console.log(`corpus: ${count} synthetic PDFs in ${cwd}`);

  const started = performance.now();
  const summary = runImport(cwd, ["docs/**/*.pdf"]);
  const elapsedMs = performance.now() - started;

  const seconds = elapsedMs / 1000;
  console.log(
    `imported ${summary.files_imported} files (${summary.chunks_written} chunks, ` +
      `${summary.warnings.length} warnings) in ${seconds.toFixed(2)}s — ` +
      `${(count / seconds).toFixed(1)} files/sec`,
  );
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
