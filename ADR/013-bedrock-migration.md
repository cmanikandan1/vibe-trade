# ADR 013: Migrate LLM access from the Anthropic API to Amazon Bedrock

**Status:** Accepted
**Date:** 2026-05-11

## Context

VibeTrade calls Claude models from four places:

1. `routes/chat.ts` — the main chat loop (streaming, tool-using).
2. `lib/heartbeat/runner.ts` — autonomous reasoning jobs triggered by the heartbeat.
3. `lib/heartbeat/evaluator.ts` — LLM-mode trigger evaluation.
4. `lib/heartbeat/event-evaluator.ts` — sentiment evaluation on news headlines.

Until this change, all four used `@anthropic-ai/sdk` directly, requiring an
`ANTHROPIC_API_KEY` stored in the credentials file and passed at runtime.

This has two problems:

- **Key sprawl.** Every user has to generate and manage an Anthropic key in
  addition to their cloud credentials.
- **Operational maturity.** Direct API access doesn't come with the IAM
  policies, CloudWatch metrics, cross-region routing, or enterprise-grade
  isolation that our operating environment expects (see `global/genai.md`:
  *"Access all models through Amazon Bedrock (never use direct API keys to
  model providers)"*).

## Decision

Replace `@anthropic-ai/sdk` with `@anthropic-ai/bedrock-sdk` everywhere it is
used for inference. Conversation history continues to use Anthropic's shared
types (`Anthropic.MessageParam`, `Anthropic.Tool`, etc.) because the two SDKs
are wire-compatible.

Key design points:

- **AWS credentials come from the default credential chain.** The app does
  not prompt for, store, or persist AWS access keys. It reads from
  `~/.aws/credentials`, environment variables, SSO, IMDS, or container role —
  whichever the host provides.
- **Cross-Region Inference (CRIS) is enabled.** The user picks a geography
  (`us`, `eu`, `apac`) which is prepended to the Bedrock base model ID at
  invocation time (e.g. `us.anthropic.claude-sonnet-4-5-20250929-v1:0`).
- **Two configurable models**, not one. Chat and reasoning jobs use the
  "reasoning model" (default Claude Sonnet 4.5); trigger and sentiment
  evaluation use the "evaluation model" (default Claude Haiku 4.5). This
  matches the cost/latency profile of each workload.
- **All LLM access goes through `lib/llm/client.ts`.** Two entry points:
  `invokeMessage` (non-streaming) and `streamMessage` (streaming). Both inject
  the CRIS-prefixed model ID and record a structured usage row.
- **Prompt caching** via `cache_control: { type: "ephemeral" }` is applied
  to the large, stable system prompts in chat and the reasoning runner. On
  supported models this reduces input-token cost significantly across the
  tool-loop iterations typical of reasoning jobs.
- **Structured usage logging** to `~/.vibetrade/llm-usage.jsonl`. Captures
  model, region, latency, input/output tokens, cache read/write tokens,
  stop reason, and any error. Aggregated via `/api/settings/llm-usage` and
  surfaced in the Settings panel.
- **Test button** (`/api/settings/test-bedrock`) pings both models with a
  1-token prompt so misconfiguration is caught at setup, not during market
  hours.

## Consequences

### Positive

- Matches `global/genai.md` and `global/security.md` steering policies.
- Users with existing AWS SSO or IAM roles get zero-config LLM access.
- CRIS routing gives us automatic failover within a geography.
- Centralised client means model selection, observability, and prompt
  caching are one-line changes going forward.
- Single source of LLM usage data, ready to ship to CloudWatch Logs or S3
  later with no application-code changes.
- Fixed a latent bug in `event-evaluator.ts` where a module-scope
  `new Anthropic()` bypassed the credentials store and would have broken
  under the Bedrock migration.

### Negative

- Users must have AWS credentials on their host. This is a heavier lift
  than a single Anthropic key for individual developers not already on AWS.
- Bedrock model IDs drift as Anthropic releases new versions; the
  `CLAUDE_MODELS` catalog in `lib/llm/models.ts` must be updated when we
  want to offer a newer model.
- Not every Claude model is available as a CRIS profile in every geography;
  surface Bedrock's error messages directly rather than guess.

### Follow-up work (out of scope for this change)

- **Bedrock Guardrails** field in settings (`global/genai.md` calls for
  guardrails on production-facing endpoints).
- **Model fallback** — automatically retry on Haiku if Sonnet throttles.
- **Per-request token budget** — user-configurable `max_tokens` cap.
- **Full AWS SSO / profile picker** in settings, rather than relying on the
  default chain alone.
- **Ship usage logs to CloudWatch Logs** once VibeTrade is hosted.

## Configuration overview

| Setting | Source of truth | Default |
|---|---|---|
| AWS credentials | Local AWS default chain (NOT stored in app) | — |
| `AWS_REGION` | env var, falls back to settings, falls back to `us-east-1` | `us-east-1` |
| `BEDROCK_GEOGRAPHY` | env var, settings | `us` |
| `BEDROCK_REASONING_MODEL` | env var, settings | `claude-sonnet-4-5` |
| `BEDROCK_EVALUATION_MODEL` | env var, settings | `claude-haiku-4-5` |

Settings changes made through the UI are persisted to
`~/.vibetrade/credentials.json` and override env values.
