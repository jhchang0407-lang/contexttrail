# Security policy

ContextTrail runs locally and stores imported document text under
`.contexttrail/` in your workspace. It makes no network calls from the
core retrieval path.

## Reporting a vulnerability

Please do not open public issues for security problems. Use GitHub's
private vulnerability reporting on this repository ("Security" tab →
"Report a vulnerability"). Reports will be acknowledged within a week.

Issues of particular interest:

- Anything that lets a crafted document escape the importer (path
  traversal, code execution through the PDF/DOCX extractors).
- Anything that lets a web page drive the localhost setup UI
  (`contexttrail ui`) across origins.
- Anything that leaks indexed document content outside the workspace.
