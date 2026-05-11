import type { FastifyInstance } from "fastify";
import { credentialsStore, getBedrockClient } from "../lib/credentials.js";
import { BrokerAuthError } from "../lib/brokers/errors.js";
import { invokeMessage, readUsageSummary, resolveModelId } from "../lib/llm/index.js";

const BROKER_CRED_FIELDS = ["DHAN_ACCESS_TOKEN", "DHAN_CLIENT_ID", "broker"] as const;
const LLM_SETTINGS_FIELDS = [
  "AWS_REGION",
  "BEDROCK_GEOGRAPHY",
  "BEDROCK_REASONING_MODEL",
  "BEDROCK_EVALUATION_MODEL",
] as const;
const ALLOWED_SETTINGS = new Set<string>([...BROKER_CRED_FIELDS, ...LLM_SETTINGS_FIELDS]);

export async function settingsRoute(fastify: FastifyInstance) {
  fastify.get("/api/settings", async () => {
    const status = credentialsStore.status();
    const allConfigured = Object.values(status).every(Boolean);
    const llm = credentialsStore.getLlmSettingsView();
    return { status, allConfigured, llm };
  });

  fastify.post("/api/settings", async (request, reply) => {
    const body = request.body as Record<string, string> | null;
    if (!body || typeof body !== "object") {
      return reply.status(400).send({ error: "Invalid request body" });
    }

    const patch: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (!ALLOWED_SETTINGS.has(key)) continue;
      if (typeof value === "string" && value.trim() !== "") {
        patch[key] = value.trim();
      }
    }

    if (Object.keys(patch).length === 0) {
      return reply.status(400).send({ error: "No valid non-empty fields provided" });
    }

    try {
      await credentialsStore.update(patch);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
    const status = credentialsStore.status();
    const llm = credentialsStore.getLlmSettingsView();
    return { success: true, status, llm };
  });

  fastify.get("/api/settings/broker-status", async () => {
    const { DHAN_ACCESS_TOKEN, DHAN_CLIENT_ID } = credentialsStore.status();
    if (!DHAN_ACCESS_TOKEN || !DHAN_CLIENT_ID) {
      return { configured: false, connected: false, expired: false };
    }
    try {
      const adapter = credentialsStore.getBrokerAdapter();
      await adapter.getFunds();
      return { configured: true, connected: true, expired: false };
    } catch (err) {
      if (err instanceof BrokerAuthError) {
        return { configured: true, connected: false, expired: true };
      }
      return { configured: true, connected: false, expired: false, error: (err as Error).message };
    }
  });

  /**
   * Smoke-tests the Bedrock configuration by issuing a 1-token ping against
   * each configured model (reasoning + evaluation) using the current region /
   * geography. Surfaces misconfigured IAM, missing model access, or invalid
   * region before the trigger heartbeat actually needs the model.
   */
  fastify.post("/api/settings/test-bedrock", async () => {
    const config = credentialsStore.getLlmConfig();
    const client = getBedrockClient();

    const tests: Array<{ role: "reasoning" | "evaluation"; modelId: string }> = [
      { role: "reasoning", modelId: config.reasoningModelId },
      { role: "evaluation", modelId: config.evaluationModelId },
    ];

    const results = await Promise.all(tests.map(async ({ role, modelId }) => {
      try {
        await invokeMessage(client, {
          config,
          role,
          purpose: "test_connection",
          params: {
            max_tokens: 8,
            messages: [{ role: "user", content: "ping" }],
          },
          timeoutMs: 15_000,
        });
        return { role, modelId, bedrockModelId: resolveModelId(modelId, config.geography), ok: true };
      } catch (err) {
        return {
          role,
          modelId,
          bedrockModelId: resolveModelId(modelId, config.geography),
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }));

    const allOk = results.every(r => r.ok);
    return { ok: allOk, region: config.region, geography: config.geography, results };
  });

  fastify.get("/api/settings/llm-usage", async (request) => {
    const query = request.query as { limit?: string };
    const limit = query.limit ? Math.max(1, Math.min(500, parseInt(query.limit, 10) || 50)) : 50;
    const summary = await readUsageSummary(limit);
    return summary;
  });
}
