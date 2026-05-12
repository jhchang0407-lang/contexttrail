import { describe, it, expect } from "vitest";
import { extractRustCodeSourceFacts } from "./code-source-rust.js";

const extract = (content: string, source_path = "src/x.rs") =>
  extractRustCodeSourceFacts({ source_path, content });

describe("extractRustCodeSourceFacts", () => {
  it("returns empty record on empty content", () => {
    expect(extract("").exported_symbols).toEqual([]);
  });

  it("extracts pub fn (sync and async) only — skips non-pub", () => {
    const out = extract([
      "pub fn public_fn(x: i32) -> bool { true }",
      "pub async fn async_fn(s: &str) { }",
      "fn private_fn() {}",
    ].join("\n"));
    const names = out.exported_symbols.map((s) => s.name).sort();
    expect(names).toEqual(["async_fn", "public_fn"]);
  });

  it("treats pub(crate) as exported", () => {
    const out = extract("pub(crate) fn crate_visible() {}");
    expect(out.exported_symbols).toEqual([{ name: "crate_visible", kind: "function" }]);
  });

  it("classifies struct / enum / trait / type", () => {
    const out = extract([
      "pub struct Server {}",
      "pub enum Status { Ready, Busy }",
      "pub trait Handler {}",
      "pub type Id = u64;",
    ].join("\n"));
    const kinds = new Map(out.exported_symbols.map((s) => [s.name, s.kind]));
    expect(kinds.get("Server")).toBe("class");
    expect(kinds.get("Status")).toBe("enum");
    expect(kinds.get("Handler")).toBe("interface");
    expect(kinds.get("Id")).toBe("type");
  });

  it("extracts pub const and pub static", () => {
    const out = extract([
      "pub const MAX_RETRIES: u32 = 5;",
      "pub static DEFAULT_NAME: &str = \"foo\";",
      "const PRIVATE: u32 = 1;",
    ].join("\n"));
    const names = out.exported_symbols.map((s) => s.name).sort();
    expect(names).toEqual(["DEFAULT_NAME", "MAX_RETRIES"]);
  });

  it("resolves crate:: use paths to corpus-relative paths", () => {
    const out = extract([
      "use crate::auth::login;",
      "use crate::retrieve::source_rerank::{scoreSourceRerank, applyTiebreakers};",
    ].join("\n"));
    expect(out.imports).toContain("auth/login");
    expect(out.imports).toContain("retrieve/source_rerank/scoreSourceRerank");
    expect(out.imports).toContain("retrieve/source_rerank/applyTiebreakers");
  });

  it("keeps stdlib / external imports verbatim", () => {
    const out = extract([
      "use std::collections::HashMap;",
      "use serde::Deserialize;",
    ].join("\n"));
    expect(out.imports).toContain("std/collections/HashMap");
    expect(out.imports).toContain("serde/Deserialize");
  });

  it("captures the //! inner module doc as file_purpose", () => {
    const out = extract([
      "//! The retrieval module.",
      "//! Implements BM25F + source-rerank.",
      "pub fn run() {}",
    ].join("\n"));
    expect(out.file_purpose).toMatch(/The retrieval module/);
    expect(out.file_purpose).toMatch(/BM25F \+ source-rerank/);
  });

  it("returns null file_purpose when no //! block", () => {
    const out = extract("pub fn fn1() {}");
    expect(out.file_purpose).toBeNull();
  });

  it("expands brace-grouped uses", () => {
    const out = extract("use crate::pkg::{a, b, c};");
    expect(out.imports.sort()).toEqual(["pkg/a", "pkg/b", "pkg/c"]);
  });

  it("does not throw on malformed source", () => {
    const out = extract("pub fn broken(");
    expect(out.exported_symbols).toEqual([]);
  });
});
