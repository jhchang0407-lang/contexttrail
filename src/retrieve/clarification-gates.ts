import type { RetrievalResult } from "./retrieve.js";
import type { PresentedContextPack } from "../mcp/presenter.js";
import type { SourceProfile } from "../types/source-profile.js";
import {
  DEFAULT_STOP_WORDS,
  tokenize as tokenizeRetrievalText,
} from "./tokenize.js";

export const CLARIFICATION_GATE_NAMES = [
  "none",
  "signal_empty_mode",
  "uncertain_or_empty",
  "unsupported_or_signal_empty",
  "conservative_low_signal",
  "foreign_profile_support",
] as const;
export type ClarificationGateName = (typeof CLARIFICATION_GATE_NAMES)[number];

export type CorpusSupportIndex = {
  profile_count: number;
  tokens: Set<string>;
  document_frequency: Map<string, number>;
  generic_document_frequency_cutoff: number;
};

export type CorpusSupportScore = {
  considered_tokens: string[];
  supported_tokens: string[];
  unsupported_tokens: string[];
  ignored_corpus_generic_tokens: string[];
  support_ratio: number;
};

export type ClarificationDecision = {
  clarify: boolean;
  reason: string;
  support?: CorpusSupportScore;
};

const FOREIGN_SUPPORT_EXTRA_STOP_WORDS = new Set([
  "what",
  "why",
  "how",
  "when",
  "where",
  "which",
  "who",
  "doc",
  "docs",
  "documentation",
  "guide",
  "guides",
  "overview",
  "reference",
  "references",
  "use",
  "uses",
  "using",
  "setup",
  "set",
  "configure",
  "configuration",
  "config",
  "add",
  "build",
  "create",
  "make",
  "run",
  "runs",
  "running",
  "work",
  "works",
  "working",
  "handle",
  "handling",
  "implement",
  "implementation",
  "integrate",
  "integration",
  "deploy",
  "deployment",
  "migrate",
  "migration",
  "database",
  "file",
  "files",
  "project",
  "projects",
  "app",
  "apps",
  "application",
  "mode",
  "api",
  "server",
  "client",
  "backend",
  "endpoint",
  "via",
  "call",
  "function",
  "functions",
  "other",
  "part",
  "directly",
  "component",
  "components",
  "command",
  "line",
  "state",
]);

const FOREIGN_SUPPORT_STOP_WORDS = new Set([
  ...DEFAULT_STOP_WORDS,
  ...FOREIGN_SUPPORT_EXTRA_STOP_WORDS,
]);

export function decideClarificationGate(
  gate: ClarificationGateName,
  response: Pick<
    PresentedContextPack,
    "query_mode" | "coverage_confidence" | "warnings" | "ranked"
  >,
  result: Pick<RetrievalResult, "top_source_coverage">,
  opts: {
    task?: string;
    corpusSupport?: CorpusSupportIndex;
    hasCallerAnchors?: boolean;
  } = {},
): ClarificationDecision {
  if (gate === "none") return { clarify: false, reason: "baseline" };

  if (gate === "signal_empty_mode") {
    return {
      clarify: response.query_mode === "signal_empty",
      reason:
        response.query_mode === "signal_empty"
          ? "query_mode_signal_empty"
          : "query_mode_has_signal",
    };
  }

  if (gate === "uncertain_or_empty") {
    return {
      clarify: response.coverage_confidence !== "confident",
      reason:
        response.coverage_confidence !== "confident"
          ? `coverage_${response.coverage_confidence}`
          : "coverage_confident",
    };
  }

  const topCoverageDecision = result.top_source_coverage?.decision;
  if (gate === "unsupported_or_signal_empty") {
    const unsupported =
      topCoverageDecision === "unsupported" ||
      topCoverageDecision === "needs_anchors";
    const signalEmpty = response.query_mode === "signal_empty";
    return {
      clarify: unsupported || signalEmpty,
      reason: unsupported
        ? `top_source_${topCoverageDecision}`
        : signalEmpty
          ? "query_mode_signal_empty"
          : "supported_signal",
    };
  }

  const anchorWarning = response.warnings.some(
    (warning) => warning.kind === "anchors_unrecognized",
  );
  if (gate === "conservative_low_signal") {
    const clarify =
      response.query_mode === "signal_empty" ||
      topCoverageDecision === "unsupported" ||
      topCoverageDecision === "needs_anchors" ||
      (response.coverage_confidence === "empty" && response.ranked.length === 0) ||
      (anchorWarning && response.coverage_confidence !== "confident");
    return {
      clarify,
      reason: clarify ? "conservative_low_signal" : "has_enough_signal",
    };
  }

  if (gate === "foreign_profile_support") {
    const support = scoreTaskCorpusSupport(opts.task ?? "", opts.corpusSupport);
    if (opts.hasCallerAnchors) {
      return {
        clarify: false,
        reason: "caller_anchor_outside_gate_scope",
        support,
      };
    }
    if (!opts.corpusSupport || opts.corpusSupport.profile_count === 0) {
      return {
        clarify: false,
        reason: "no_corpus_support_index",
        support,
      };
    }
    if (support.considered_tokens.length === 0) {
      return {
        clarify: false,
        reason: "no_domain_tokens",
        support,
      };
    }

    const weakSupport =
      support.considered_tokens.length >= 2 && support.support_ratio <= 0.25;
    const noSupport = support.supported_tokens.length === 0;
    const lowResultConfidence =
      response.coverage_confidence !== "confident" ||
      topCoverageDecision === "unsupported" ||
      topCoverageDecision === "needs_anchors";
    const clarify = noSupport || (weakSupport && lowResultConfidence);
    return {
      clarify,
      reason: clarify
        ? noSupport
          ? "no_profile_domain_support"
          : "weak_profile_domain_support"
        : "profile_domain_supported",
      support,
    };
  }

  return assertNever(gate);
}

export function buildCorpusSupportIndex(
  profiles: SourceProfile[],
): CorpusSupportIndex {
  const tokens = new Set<string>();
  const documentFrequency = new Map<string, number>();
  for (const profile of profiles) {
    const profileTokens = new Set(profileSupportTokens(profile));
    for (const token of profileTokens) {
      tokens.add(token);
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  return {
    profile_count: profiles.length,
    tokens,
    document_frequency: documentFrequency,
    generic_document_frequency_cutoff: Math.max(
      3,
      Math.ceil(profiles.length * 0.25),
    ),
  };
}

export function scoreTaskCorpusSupport(
  task: string,
  corpusSupport?: CorpusSupportIndex,
): CorpusSupportScore {
  const considered = dedupePreserveOrder(
    tokenizeRetrievalText(task, {
      stopWords: FOREIGN_SUPPORT_STOP_WORDS,
      stem: true,
    }),
  );
  const domainTokens = corpusSupport
    ? considered.filter((token) => !isCorpusGenericToken(token, corpusSupport))
    : considered;
  const ignoredCorpusGeneric = corpusSupport
    ? considered.filter((token) => isCorpusGenericToken(token, corpusSupport))
    : [];
  const supported = corpusSupport
    ? domainTokens.filter((token) => corpusSupport.tokens.has(token))
    : [];
  const unsupported = corpusSupport
    ? domainTokens.filter((token) => !corpusSupport.tokens.has(token))
    : domainTokens;
  return {
    considered_tokens: domainTokens,
    supported_tokens: supported,
    unsupported_tokens: unsupported,
    ignored_corpus_generic_tokens: ignoredCorpusGeneric,
    support_ratio:
      domainTokens.length === 0 ? 1 : supported.length / domainTokens.length,
  };
}

function isCorpusGenericToken(
  token: string,
  corpusSupport: CorpusSupportIndex,
): boolean {
  return (
    (corpusSupport.document_frequency.get(token) ?? 0) >=
    corpusSupport.generic_document_frequency_cutoff
  );
}

function profileSupportTokens(profile: SourceProfile): string[] {
  const parts: string[] = [
    profile.source_path,
    profile.title,
    profile.h1 ?? "",
    profile.nav_label ?? "",
    profile.package_segment ?? "",
    profile.version_segment ?? "",
    ...profile.aliases.map((alias) => alias.value),
    ...profile.heading_outline.map((heading) => heading.text),
    ...(profile.heading_aliases ?? []).map((alias) => alias.surface),
  ];
  return parts.flatMap((part) =>
    tokenizeRetrievalText(part, {
      stopWords: FOREIGN_SUPPORT_STOP_WORDS,
      stem: true,
    }),
  );
}

function dedupePreserveOrder<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled clarification gate: ${String(value)}`);
}
