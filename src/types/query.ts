export const QUERY_INTENTS = [
	"exact_symbol",
	"file_anchored",
	"route_anchored",
	"cross_module",
	"broad_domain",
	"decision_lookup",
	"symptom_debugging",
	"signal_empty",
] as const;

export type QueryIntent = (typeof QUERY_INTENTS)[number];
