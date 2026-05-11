/**
 * Thin wrapper around @anthropic-ai/bedrock-sdk that:
 *   1. Resolves the correct CRIS model ID based on configured geography.
 *   2. Emits a structured usage record for every call.
 *   3. Relies on the default AWS credential chain — NO access keys in settings.
 *
 * The Bedrock SDK is API-compatible with @anthropic-ai/sdk for messages.create
 * and messages.stream, so consumers can treat the returned `client` like the
 * Anthropic client they already use.
 */

import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import type Anthropic from "@anthropic-ai/sdk";
import {
  DEFAULT_EVALUATION_MODEL_ID,
  DEFAULT_GEOGRAPHY,
  DEFAULT_REASONING_MODEL_ID,
  findModel,
  resolveModelId,
  type BedrockGeography,
  type ModelSpec,
} from "./models.js";
import { logUsage, type UsagePurpose } from "./usage-logger.js";

export interface LlmConfig {
  /** AWS region (e.g. "us-east-1"). Passed to the Bedrock SDK. */
  region: string;
  /** CRIS geography prefix. */
  geography: BedrockGeography;
  /** Logical model id for high-reasoning calls (chat, reasoning jobs). */
  reasoningModelId: string;
  /** Logical model id for evaluation calls (triggers, sentiment). */
  evaluationModelId: string;
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  region: process.env.AWS_REGION ?? "us-east-1",
  geography: (process.env.BEDROCK_GEOGRAPHY as BedrockGeography | undefined) ?? DEFAULT_GEOGRAPHY,
  reasoningModelId: process.env.BEDROCK_REASONING_MODEL ?? DEFAULT_REASONING_MODEL_ID,
  evaluationModelId: process.env.BEDROCK_EVALUATION_MODEL ?? DEFAULT_EVALUATION_MODEL_ID,
};

export type ClientRole = "reasoning" | "evaluation";

function pickModelId(config: LlmConfig, role: ClientRole): string {
  return role === "reasoning" ? config.reasoningModelId : config.evaluationModelId;
}

/** Returns the raw Bedrock client. Prefer `invokeMessage` / `streamMessage`. */
export function buildBedrockClient(region: string): AnthropicBedrock {
  // The SDK reads AWS credentials from the default provider chain
  // (env, shared credentials file, IMDS, container role, SSO profile...).
  return new AnthropicBedrock({ awsRegion: region });
}

export interface InvokeOpts {
  config: LlmConfig;
  role: ClientRole;
  purpose: UsagePurpose;
  correlationId?: string;
  /** Raw arguments for Anthropic.messages.create — model is injected. */
  params: Omit<Anthropic.MessageCreateParamsNonStreaming, "model">;
  /** Optional per-call timeout override in ms. */
  timeoutMs?: number;
}

export function modelSpecFor(config: LlmConfig, role: ClientRole): ModelSpec {
  const spec = findModel(pickModelId(config, role));
  if (!spec) throw new Error(`Configured ${role} model is unknown: ${pickModelId(config, role)}`);
  return spec;
}

/**
 * Non-streaming invocation. Injects the model id, times the call, and emits
 * a usage record whether it succeeds or fails.
 *
 * The return type is pinned to `Anthropic.Message` from the top-level
 * `@anthropic-ai/sdk` package because bedrock-sdk bundles its own copy and
 * the dual type identities don't unify. The runtime shape is identical — the
 * cast is safe.
 */
export async function invokeMessage(client: AnthropicBedrock, opts: InvokeOpts): Promise<Anthropic.Message> {
  const spec = modelSpecFor(opts.config, opts.role);
  const bedrockModelId = resolveModelId(spec.id, opts.config.geography);
  const start = Date.now();

  try {
    const resp = await client.messages.create(
      { ...opts.params, model: bedrockModelId } as Parameters<AnthropicBedrock["messages"]["create"]>[0],
      opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined,
    ) as unknown as Anthropic.Message;
    const usage = resp.usage;
    await logUsage({
      ts: new Date().toISOString(),
      purpose: opts.purpose,
      modelId: spec.id,
      bedrockModelId,
      region: opts.config.region,
      latencyMs: Date.now() - start,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheReadTokens: (usage as { cache_read_input_tokens?: number } | undefined)?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: (usage as { cache_creation_input_tokens?: number } | undefined)?.cache_creation_input_tokens ?? 0,
      stopReason: resp.stop_reason ?? undefined,
      correlationId: opts.correlationId,
    });
    return resp;
  } catch (err) {
    await logUsage({
      ts: new Date().toISOString(),
      purpose: opts.purpose,
      modelId: spec.id,
      bedrockModelId,
      region: opts.config.region,
      latencyMs: Date.now() - start,
      inputTokens: 0,
      outputTokens: 0,
      errored: true,
      error: err instanceof Error ? err.message : String(err),
      correlationId: opts.correlationId,
    });
    throw err;
  }
}

export interface StreamOpts {
  config: LlmConfig;
  role: ClientRole;
  purpose: UsagePurpose;
  correlationId?: string;
  params: Omit<Anthropic.MessageStreamParams, "model">;
}

export interface StreamResult {
  /** Underlying stream object — use `.on("text", ...)` / `.finalMessage()`. */
  stream: ReturnType<AnthropicBedrock["messages"]["stream"]>;
  /**
   * Must be awaited after stream completion so we can emit the usage record.
   * Callers that use `finalMessage()` should pass the final message in.
   *
   * The parameter is typed `unknown` on purpose: bedrock-sdk ships its own
   * nested copy of `@anthropic-ai/sdk`, so the two `Message` types aren't
   * structurally interchangeable at compile time (they are at runtime).
   */
  recordUsage: (finalMessage: unknown, errored?: boolean, error?: string) => Promise<void>;
}

/**
 * Streaming invocation. Returns the stream plus a helper to record usage once
 * the caller knows the outcome (needed because SDK streams are lazy about
 * exposing usage until the final message).
 */
export function streamMessage(client: AnthropicBedrock, opts: StreamOpts): StreamResult {
  const spec = modelSpecFor(opts.config, opts.role);
  const bedrockModelId = resolveModelId(spec.id, opts.config.geography);
  const start = Date.now();

  const stream = client.messages.stream({
    ...opts.params,
    model: bedrockModelId,
  } as Parameters<AnthropicBedrock["messages"]["stream"]>[0]);

  const recordUsage = async (finalMessage: unknown, errored = false, error?: string) => {
    const msg = finalMessage as Anthropic.Message | null;
    const usage = msg?.usage;
    await logUsage({
      ts: new Date().toISOString(),
      purpose: opts.purpose,
      modelId: spec.id,
      bedrockModelId,
      region: opts.config.region,
      latencyMs: Date.now() - start,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheReadTokens: (usage as { cache_read_input_tokens?: number } | undefined)?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: (usage as { cache_creation_input_tokens?: number } | undefined)?.cache_creation_input_tokens ?? 0,
      stopReason: msg?.stop_reason ?? undefined,
      errored,
      error,
      correlationId: opts.correlationId,
    });
  };

  return { stream, recordUsage };
}
