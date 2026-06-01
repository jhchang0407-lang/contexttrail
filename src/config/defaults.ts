import { z } from "zod";

const DocRoleSchema = z.enum(["canonical", "ideation", "example", "archive"]);

const DocumentSourceSchema = z.object({
	id: z.string(),
	path: z.string(),
	glob: z.string().default("**/*.{md,markdown,txt,docx,pdf}"),
});

const TaskProfileSchema = z.object({
	id: z.string(),
	name: z.string(),
	document_sources: z.array(DocumentSourceSchema).default([]),
	rule_ids: z.array(z.string()).default([]),
	created_at: z.string(),
	updated_at: z.string(),
});

export const ConfigSchema = z.object({
	version: z.number().default(1),
	cards: z
		.object({
			source_dir: z.string().default(".contexttrail/cards"),
		})
		.default({ source_dir: ".contexttrail/cards" }),
	inbox: z
		.object({
			source_dir: z.string().default(".contexttrail/inbox"),
		})
		.default({ source_dir: ".contexttrail/inbox" }),
	document_sources: z.array(DocumentSourceSchema).default([]),
	active_task_profile_id: z.string().nullable().default(null),
	task_profiles: z.array(TaskProfileSchema).default([]),
	doc_scopes: z
		.array(
			z.object({
				id: z.string(),
				pattern: z.string(),
				scope: z.object({
					layer: z.enum([
						"company",
						"team",
						"project",
						"module",
						"decision",
						"unknown",
					]),
					project: z.string().optional(),
					module: z.string().optional(),
					team: z.string().optional(),
					company: z.string().optional(),
					module_from_path_after: z.string().optional(),
					module_from_path: z.number().optional(),
				}),
			}),
		)
		.default([]),
	code_scopes: z
		.array(
			z.object({
				id: z.string(),
				pattern: z.string(),
				scope: z.object({
					layer: z.enum([
						"company",
						"team",
						"project",
						"module",
						"decision",
						"unknown",
					]),
					project: z.string().optional(),
					module: z.string().optional(),
					team: z.string().optional(),
					company: z.string().optional(),
					module_from_path_after: z.string().optional(),
					module_from_path: z.number().optional(),
				}),
			}),
		)
		.default([]),
	// PRD-0028 / slice 28.2: code-source globs for the structural code-
	// source index. Default covers TypeScript, JavaScript, Python, Go,
	// and Rust — same `CodeSourceFacts` shape regardless of language;
	// dispatch lives in `src/parse/code-source-dispatch.ts`. Test files,
	// declaration files, and vendored deps are skipped via `code_ignore`.
	code_globs: z
		.array(z.string())
		.default([
			"src/**/*.ts",
			"src/**/*.tsx",
			"src/**/*.js",
			"src/**/*.jsx",
			"packages/**/*.ts",
			"packages/**/*.tsx",
			"packages/**/*.js",
			"packages/**/*.jsx",
			"apps/**/*.ts",
			"apps/**/*.tsx",
			"apps/**/*.js",
			"apps/**/*.jsx",
			"lib/**/*.ts",
			"lib/**/*.tsx",
			"lib/**/*.js",
			"lib/**/*.jsx",
			"**/*.ts",
			"**/*.tsx",
			"**/*.js",
			"**/*.jsx",
			"src/**/*.py",
			"src/**/*.go",
			"src/**/*.rs",
			"crates/**/*.rs",
			"pkg/**/*.go",
			"cmd/**/*.go",
			"internal/**/*.go",
			"**/*.py",
			"**/*.go",
			"**/*.rs",
		]),
	code_ignore: z
		.array(z.string())
		.default([
			"**/node_modules/**",
			"**/*.test.ts",
			"**/*.test.tsx",
			"**/*.test.js",
			"**/*.test.jsx",
			"**/*.test-d.ts",
			"**/*.spec.ts",
			"**/*.spec.tsx",
			"**/*.spec.js",
			"**/*.spec.jsx",
			"**/*.d.ts",
			"**/__tests__/**",
			"**/test/**",
			"**/tests/**",
			"**/fixtures/**",
			"**/examples/**",
			"**/__pycache__/**",
			"**/test_*.py",
			"**/*_test.go",
			"**/target/**",
			"**/vendor/**",
			"**/.git/**",
		]),
	doc_roles: z
		.array(
			z.object({
				pattern: z.string(),
				role: DocRoleSchema,
			}),
		)
		.default([
			{
				pattern: "docs/{CONTEXT,VISION,IDEAS,DESIGN,SCHEMA,CORE,MVP,OPEN}.md",
				role: "ideation",
			},
			{ pattern: "docs/archive/**", role: "archive" },
			{ pattern: "docs/runbooks/**", role: "canonical" },
			{ pattern: "docs/adr/**", role: "canonical" },
			{ pattern: "docs/prd/**", role: "canonical" },
		]),
	chunking: z
		.object({
			strategy: z.string().default("heading_with_cap"),
			target_tokens: z.number().default(500),
			max_tokens: z.number().default(900),
			overlap_tokens: z.number().default(0),
			merge_adjacent_sections: z.boolean().default(false),
			oversized_atomic_blocks: z.string().default("preserve_and_warn"),
			context_header: z.boolean().default(true),
			split_by: z.string().default("paragraph"),
			preserve_blocks: z
				.array(z.string())
				.default(["code_fence", "table", "list"]),
		})
		.default({}),
	// v1 supports exactly one tokenizer encoding (D28). Locking it here means
	// a config typo or unsupported encoding fails fast at config-load time
	// rather than producing silently mis-counted tokens. Add new encodings to
	// this enum (and to makeTokenCounter) when they're actually supported.
	tokenizer: z
		.object({
			encoding: z.enum(["cl100k_base"]).default("cl100k_base"),
		})
		.default({ encoding: "cl100k_base" }),
	chunk_identity: z
		.object({
			stable_key: z
				.string()
				.default(
					"hash(source_path + heading_path + chunk_index_within_section)",
				),
			version_id: z.string().default("hash(stable_key + content_hash)"),
			rename_recovery: z.string().default("deferred"),
		})
		.default({}),
	indexing: z
		.object({
			mode: z.enum(["implicit", "manual"]).default("implicit"),
			tombstone_retention: z.string().default("indefinite"),
		})
		.default({}),
	retrieval: z
		.object({
			budgets: z
				.object({
					small: z.number().default(4000),
					default: z.number().default(6000),
					large: z.number().default(10000),
				})
				.default({}),
			min_final_score: z.number().default(0.05),
			// Per-field BM25F weights. SQLite FTS5's bm25() takes per-column weights;
			// these are the multipliers passed to bm25(doc_chunks_fts, w_title,
			// w_heading_path, w_body). Higher = matches in that field count more.
			// Cards FTS table has only title and body; uses w_title and w_body.
			field_weights: z
				.object({
					title: z.number().default(2.5),
					heading_path: z.number().default(1.5),
					body: z.number().default(1.0),
				})
				.default({}),
			scoring: z
				.object({
					w_bm25: z.number().default(0.7),
					w_heading: z.number().default(0.3),
					w_scope: z.number().default(0.7),
					w_mentions: z.number().default(0.8),
					// D42: non-locked Cards win ties vs. ambient prose at equal relevance.
					// Locked Cards bypass the ranker entirely; this multiplier never applies to them.
					card_type_bias: z.number().default(1.2),
					specificity_weight: z
						.object({
							module: z.number().default(1.4),
							project: z.number().default(1.2),
							decision: z.number().default(1.1),
							team: z.number().default(1.0),
							company: z.number().default(0.9),
							unknown: z.number().default(1.0),
						})
						.default({}),
				})
				.default({}),
		})
		.default({}),
});

export type ContextTrailConfig = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG_YAML = `version: 1

# Doc import scope rules — frontmatter overrides; built-in defaults below
inbox:
  source_dir: .contexttrail/inbox

cards:
  source_dir: .contexttrail/cards

# Saved local document folders. The UI can add entries here so Sync pulls new
# Markdown/text files without requiring repeated uploads.
document_sources: []

# Named snapshots of document folders + Agent Rule IDs for switching tasks.
active_task_profile_id: null
task_profiles: []

doc_scopes:
  - id: docs-project-default
    pattern: "docs/**/*.md"
    scope:
      layer: project
  - id: root-readme-project
    pattern: "README.md"
    scope:
      layer: project
  - id: module-readmes
    pattern: "src/**/README.md"
    scope:
      layer: module
      module_from_path_after: src
  - id: package-readmes
    pattern: "packages/*/README.md"
    scope:
      layer: module
      module_from_path: 1
  - id: adr-docs
    pattern: "{docs,doc}/**/{adr,ADR,adrs,ADRs,decisions,Decisions}/**/*.md"
    scope:
      layer: decision

# Code anchor scope rules — fallback for file anchors only when no anchored
# card/chunk contributes scope.
code_scopes: []

# Doc role rules — frontmatter doc_role overrides these path defaults.
doc_roles:
  - pattern: "docs/{CONTEXT,VISION,IDEAS,DESIGN,SCHEMA,CORE,MVP,OPEN}.md"
    role: ideation
  - pattern: "docs/archive/**"
    role: archive
  - pattern: "docs/runbooks/**"
    role: canonical
  - pattern: "docs/adr/**"
    role: canonical
  - pattern: "docs/prd/**"
    role: canonical

# Chunking
chunking:
  strategy: heading_with_cap
  target_tokens: 500
  max_tokens: 900
  overlap_tokens: 0
  merge_adjacent_sections: false
  oversized_atomic_blocks: preserve_and_warn
  context_header: true
  split_by: paragraph
  preserve_blocks: [code_fence, table, list]

# Tokenizer
tokenizer:
  encoding: cl100k_base

# Indexing
indexing:
  mode: implicit
  tombstone_retention: indefinite

# Retrieval
retrieval:
  budgets:
    small: 4000
    default: 6000
    large: 10000
  min_final_score: 0.05
  scoring:
    w_bm25: 0.70
    w_heading: 0.30
    w_scope: 0.70
    w_mentions: 0.80
    card_type_bias: 1.20
    specificity_weight:
      module: 1.40
      project: 1.20
      decision: 1.10
      team: 1.00
      company: 0.90
      unknown: 1.00
`;
