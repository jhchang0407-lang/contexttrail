import { describe, it, expect } from "vitest";
import { resolveScope } from "./resolve.js";
import { ConfigSchema, type ContextTrailConfig } from "../config/defaults.js";

const cfg = (rules: ContextTrailConfig["doc_scopes"]): ContextTrailConfig =>
	ConfigSchema.parse({ doc_scopes: rules });

describe("scope resolver — D33 precedence", () => {
	it("config rule applies layer to docs/**/*.md", () => {
		const c = cfg([
			{
				id: "docs",
				pattern: "docs/**/*.md",
				scope: { layer: "project" },
			},
		]);
		const r = resolveScope({
			source_path: "docs/payments/refunds.md",
			frontmatter: {},
			config: c,
		});
		expect(r.layer).toBe("project");
		expect(r.source.config_rule).toBe("docs");
	});

	it("frontmatter overrides config rule per-field (config supplies layer, fm supplies project)", () => {
		const c = cfg([
			{ id: "docs", pattern: "docs/**/*.md", scope: { layer: "project" } },
		]);
		const r = resolveScope({
			source_path: "docs/billing.md",
			frontmatter: { scope: { project: "billing" } },
			config: c,
		});
		expect(r.layer).toBe("project");
		expect(r.project).toBe("billing");
		expect(r.source.frontmatter).toBe(true);
		expect(r.source.config_rule).toBe("docs");
	});

	it("multi-rule precedence: first match wins", () => {
		const c = cfg([
			{
				id: "adr-docs",
				pattern: "{docs,doc}/**/{adr,decisions}/**/*.md",
				scope: { layer: "decision" },
			},
			{
				id: "docs-project",
				pattern: "docs/**/*.md",
				scope: { layer: "project" },
			},
		]);
		const r = resolveScope({
			source_path: "docs/adr/0001-foo.md",
			frontmatter: {},
			config: c,
		});
		expect(r.layer).toBe("decision");
		expect(r.source.config_rule).toBe("adr-docs");
	});

	it("no auto-derive of project from `docs/<segment>` (D33 lock)", () => {
		const c = cfg([
			{ id: "docs", pattern: "docs/**/*.md", scope: { layer: "project" } },
		]);
		const r = resolveScope({
			source_path: "docs/architecture/foo.md",
			frontmatter: {},
			config: c,
		});
		expect(r.layer).toBe("project");
		expect(r.project).toBeUndefined();
	});

	it("module_from_path_after picks single segment after marker", () => {
		const c = cfg([
			{
				id: "module-readmes",
				pattern: "src/**/README.md",
				scope: { layer: "module", module_from_path_after: "src" },
			},
		]);
		const r = resolveScope({
			source_path: "src/payments/internal/README.md",
			frontmatter: {},
			config: c,
		});
		expect(r.layer).toBe("module");
		expect(r.module).toBe("payments");
	});

	it("module_from_path picks a fixed positional segment", () => {
		const c = cfg([
			{
				id: "package-readmes",
				pattern: "packages/*/README.md",
				scope: { layer: "module", module_from_path: 1 },
			},
		]);
		const r = resolveScope({
			source_path: "packages/auth/README.md",
			frontmatter: {},
			config: c,
		});
		expect(r.module).toBe("auth");
	});

	it("no rule matches → unknown", () => {
		const r = resolveScope({
			source_path: "random/file.md",
			frontmatter: {},
			config: cfg([]),
		});
		expect(r.layer).toBe("unknown");
	});
});
