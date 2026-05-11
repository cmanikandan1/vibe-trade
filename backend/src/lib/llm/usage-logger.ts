/**
 * Persistent, structured log of every Bedrock invocation.
 *
 * Writes one JSON line per call to `~/.vibetrade/llm-usage.jsonl`. Aggregates
 * can be computed on demand via `readUsageSummary` — we prefer an append-only
 * log over an aggregated counter because it preserves the audit trail required
 * by global/genai.md ("Log all model interactions for audit trails").
 */

import { appendFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { getDataDir } from "../data-dir.js";

export type UsagePurpose = "chat" | "reasoning_job" | "llm_trigger_eval" | "sentiment_eval" | "test_connection";

export interface UsageRecord {
  ts: string;
  /** Which subsystem made the call. */
  purpose: UsagePurpose;
  /** Logical model id (e.g. "claude-sonnet-4-5"). */
  modelId: string;
  /** Full Bedrock model id actually invoked (CRIS-prefixed). */
  bedrockModelId: string;
  /** AWS region the request was sent to. */
  region: string;
  /** End-to-end latency in milliseconds. */
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  /** Tokens read from prompt cache (if any). */
  cacheReadTokens?: number;
  /** Tokens written to prompt cache (if any). */
  cacheWriteTokens?: number;
  /** Claude stop reason. */
  stopReason?: string;
  /** `true` if the call threw. `error` carries the message. */
  errored?: boolean;
  error?: string;
  /** Optional caller-supplied correlation id (trigger id, conversation id, etc.). */
  correlationId?: string;
}

export interface UsageSummary {
  totals: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    errors: number;
  };
  byPurpose: Record<UsagePurpose, { calls: number; inputTokens: number; outputTokens: number }>;
  byModel: Record<string, { calls: number; inputTokens: number; outputTokens: number }>;
  /** Most recent `limit` records, newest first. */
  recent: UsageRecord[];
}

const USAGE_FILE = "llm-usage.jsonl";

function logPath(): string {
  return join(getDataDir(), USAGE_FILE);
}

/**
 * Append a structured record. Never throws — logging must not break the hot
 * path. Failures are printed to stderr so they remain debuggable.
 */
export async function logUsage(record: UsageRecord): Promise<void> {
  try {
    await appendFile(logPath(), JSON.stringify(record) + "\n", "utf-8");
  } catch (err) {
    console.error("[llm-usage] failed to write record:", err);
  }

  // Also emit a structured stdout line — plays nicely with CloudWatch /
  // container log shippers without adding a dependency.
  console.log("[llm-usage]", JSON.stringify({
    purpose: record.purpose,
    model: record.modelId,
    region: record.region,
    latencyMs: record.latencyMs,
    in: record.inputTokens,
    out: record.outputTokens,
    cacheRead: record.cacheReadTokens ?? 0,
    cacheWrite: record.cacheWriteTokens ?? 0,
    errored: record.errored ?? false,
  }));
}

/**
 * Read the log and produce an aggregate summary. `limit` controls how many
 * recent records are returned verbatim (default 50). The aggregation itself
 * covers the entire file.
 */
export async function readUsageSummary(limit = 50): Promise<UsageSummary> {
  const summary: UsageSummary = {
    totals: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, errors: 0 },
    byPurpose: {
      chat: { calls: 0, inputTokens: 0, outputTokens: 0 },
      reasoning_job: { calls: 0, inputTokens: 0, outputTokens: 0 },
      llm_trigger_eval: { calls: 0, inputTokens: 0, outputTokens: 0 },
      sentiment_eval: { calls: 0, inputTokens: 0, outputTokens: 0 },
      test_connection: { calls: 0, inputTokens: 0, outputTokens: 0 },
    },
    byModel: {},
    recent: [],
  };

  const path = logPath();
  if (!existsSync(path)) return summary;

  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    console.error("[llm-usage] failed to read log:", err);
    return summary;
  }

  const lines = raw.split("\n").filter(l => l.trim() !== "");
  for (const line of lines) {
    let rec: UsageRecord;
    try { rec = JSON.parse(line) as UsageRecord; }
    catch { continue; }

    summary.totals.calls++;
    summary.totals.inputTokens += rec.inputTokens ?? 0;
    summary.totals.outputTokens += rec.outputTokens ?? 0;
    summary.totals.cacheReadTokens += rec.cacheReadTokens ?? 0;
    summary.totals.cacheWriteTokens += rec.cacheWriteTokens ?? 0;
    if (rec.errored) summary.totals.errors++;

    const p = summary.byPurpose[rec.purpose];
    if (p) {
      p.calls++;
      p.inputTokens += rec.inputTokens ?? 0;
      p.outputTokens += rec.outputTokens ?? 0;
    }

    const m = summary.byModel[rec.modelId] ??= { calls: 0, inputTokens: 0, outputTokens: 0 };
    m.calls++;
    m.inputTokens += rec.inputTokens ?? 0;
    m.outputTokens += rec.outputTokens ?? 0;
  }

  summary.recent = lines.slice(-limit).reverse().map(l => JSON.parse(l) as UsageRecord);
  return summary;
}
