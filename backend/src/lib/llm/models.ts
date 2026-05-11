/**
 * Catalog of Claude models available on Amazon Bedrock via Cross-Region
 * Inference (CRIS). Each entry captures the Bedrock-specific base model ID —
 * the CRIS prefix (e.g. "us.") is prepended at call time based on the
 * user-selected geography, see `resolveModelId`.
 *
 * Adding a new model: append to CLAUDE_MODELS and optionally ALTERNATIVE_MODELS.
 * The UI picks them up automatically.
 */

export type ModelTier = "haiku" | "sonnet" | "opus" | "nova" | "llama";

export interface ModelSpec {
  /** Short, stable identifier used in settings and logs. */
  id: string;
  /** Human-readable label shown in the UI dropdown. */
  label: string;
  /** Bedrock base model ID (without the CRIS region prefix). */
  bedrockBaseId: string;
  tier: ModelTier;
  /** Short description for UI tooltips. */
  description: string;
  /** Supports prompt caching via `cache_control` blocks. */
  supportsPromptCaching: boolean;
  /** Approximate context window in tokens (informational only). */
  contextWindow: number;
}

/** Default Claude models — the curated set. */
export const CLAUDE_MODELS: ModelSpec[] = [
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    bedrockBaseId: "anthropic.claude-haiku-4-5-20251001-v1:0",
    tier: "haiku",
    description: "Fast, low-cost. Ideal for trigger evaluation and lightweight classification.",
    supportsPromptCaching: true,
    contextWindow: 200_000,
  },
  {
    id: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    bedrockBaseId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
    tier: "sonnet",
    description: "Balanced reasoning + cost. Recommended default for chat and reasoning jobs.",
    supportsPromptCaching: true,
    contextWindow: 200_000,
  },
  {
    id: "claude-opus-4-1",
    label: "Claude Opus 4.1",
    bedrockBaseId: "anthropic.claude-opus-4-1-20250805-v1:0",
    tier: "opus",
    description: "Deepest reasoning. Use for complex multi-step analysis — higher cost.",
    supportsPromptCaching: true,
    contextWindow: 200_000,
  },
];

/**
 * Alternative models, surfaced in the dropdown with a clear label.
 * Per global/genai.md, these are only used when the user explicitly picks them.
 */
export const ALTERNATIVE_MODELS: ModelSpec[] = [
  {
    id: "nova-lite",
    label: "Amazon Nova Lite",
    bedrockBaseId: "amazon.nova-lite-v1:0",
    tier: "nova",
    description: "Low-cost Amazon model — simple extraction only. Does not support tool-calling for chat.",
    supportsPromptCaching: false,
    contextWindow: 300_000,
  },
];

export const ALL_MODELS: ModelSpec[] = [...CLAUDE_MODELS, ...ALTERNATIVE_MODELS];

export type BedrockGeography = "us" | "eu" | "apac";

export const GEOGRAPHIES: { id: BedrockGeography; label: string; defaultRegion: string }[] = [
  { id: "us", label: "United States (us-east-1 / us-west-2)", defaultRegion: "us-east-1" },
  { id: "eu", label: "Europe (eu-west-1 / eu-central-1)", defaultRegion: "eu-west-1" },
  { id: "apac", label: "Asia Pacific (ap-south-1 / ap-northeast-1)", defaultRegion: "ap-south-1" },
];

export const DEFAULT_GEOGRAPHY: BedrockGeography = "us";
export const DEFAULT_REASONING_MODEL_ID = "claude-sonnet-4-5";
export const DEFAULT_EVALUATION_MODEL_ID = "claude-haiku-4-5";

export function findModel(id: string): ModelSpec | undefined {
  return ALL_MODELS.find(m => m.id === id);
}

/**
 * Build the full Bedrock model ID for invocation, applying the CRIS prefix
 * for the configured geography. Not every model has a CRIS profile in every
 * geography — this returns the prefixed ID unconditionally; Bedrock will
 * surface a clear error if the profile isn't available.
 *
 * Examples:
 *   resolveModelId("claude-sonnet-4-5", "us")
 *     -> "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
 */
export function resolveModelId(modelId: string, geography: BedrockGeography): string {
  const spec = findModel(modelId);
  if (!spec) throw new Error(`Unknown model: ${modelId}`);
  return `${geography}.${spec.bedrockBaseId}`;
}
