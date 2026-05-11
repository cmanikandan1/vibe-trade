import type AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { createBrokerAdapter } from "./brokers/index.js";
import type { BrokerAdapter } from "./brokers/types.js";
import type { CredentialsStore } from "./storage/types.js";
import {
  ALL_MODELS,
  DEFAULT_EVALUATION_MODEL_ID,
  DEFAULT_GEOGRAPHY,
  DEFAULT_LLM_CONFIG,
  DEFAULT_REASONING_MODEL_ID,
  buildBedrockClient,
  findModel,
  type BedrockGeography,
  type LlmConfig,
} from "./llm/index.js";

type BrokerCredentialKey = "DHAN_ACCESS_TOKEN" | "DHAN_CLIENT_ID";

interface CredentialsMap {
  broker?: string;
  DHAN_ACCESS_TOKEN?: string;
  DHAN_CLIENT_ID?: string;
  // LLM configuration (stored alongside broker creds for convenience).
  AWS_REGION?: string;
  BEDROCK_GEOGRAPHY?: BedrockGeography;
  BEDROCK_REASONING_MODEL?: string;
  BEDROCK_EVALUATION_MODEL?: string;
}

interface ServiceRefs {
  heartbeat: { setBrokerAdapter(a: BrokerAdapter): void } | null;
}

const VALID_GEOGRAPHIES: ReadonlySet<BedrockGeography> = new Set(["us", "eu", "apac"]);

function sanitizeGeography(v: string | undefined): BedrockGeography | undefined {
  return v && VALID_GEOGRAPHIES.has(v as BedrockGeography) ? (v as BedrockGeography) : undefined;
}

function sanitizeModelId(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return findModel(v) ? v : undefined;
}

class AppCredentialsStore {
  private map: CredentialsMap = {};
  private brokerAdapter: BrokerAdapter | null = null;
  private bedrockClient: AnthropicBedrock | null = null;
  private llmConfig: LlmConfig = DEFAULT_LLM_CONFIG;
  private services: ServiceRefs = { heartbeat: null };
  private store: CredentialsStore | null = null;

  init(store: CredentialsStore): void {
    this.store = store;
  }

  async load(): Promise<void> {
    const envMap: CredentialsMap = {};
    if (process.env.DHAN_ACCESS_TOKEN) envMap.DHAN_ACCESS_TOKEN = process.env.DHAN_ACCESS_TOKEN;
    if (process.env.DHAN_CLIENT_ID) envMap.DHAN_CLIENT_ID = process.env.DHAN_CLIENT_ID;
    if (process.env.AWS_REGION) envMap.AWS_REGION = process.env.AWS_REGION;
    const envGeo = sanitizeGeography(process.env.BEDROCK_GEOGRAPHY);
    if (envGeo) envMap.BEDROCK_GEOGRAPHY = envGeo;
    const envReasoning = sanitizeModelId(process.env.BEDROCK_REASONING_MODEL);
    if (envReasoning) envMap.BEDROCK_REASONING_MODEL = envReasoning;
    const envEval = sanitizeModelId(process.env.BEDROCK_EVALUATION_MODEL);
    if (envEval) envMap.BEDROCK_EVALUATION_MODEL = envEval;

    const saved = await this.store?.read();
    this.map = saved ? { ...envMap, ...(saved as CredentialsMap) } : envMap;
    this.rebuildClients();
  }

  /**
   * UI-facing status. AWS credentials are considered "configured" when the
   * default chain can produce something — we don't prompt the user for keys.
   * For the purposes of the settings screen we surface a boolean per broker
   * credential plus the selected LLM config.
   */
  status(): { DHAN_ACCESS_TOKEN: boolean; DHAN_CLIENT_ID: boolean } {
    return {
      DHAN_ACCESS_TOKEN: Boolean(this.map.DHAN_ACCESS_TOKEN),
      DHAN_CLIENT_ID: Boolean(this.map.DHAN_CLIENT_ID),
    };
  }

  /** Returns the current LLM config (region, geography, selected model ids). */
  getLlmConfig(): LlmConfig {
    return { ...this.llmConfig };
  }

  /**
   * Returns all knobs the UI needs to render the settings screen.
   * Exposes the catalog of available models so the frontend stays in sync.
   */
  getLlmSettingsView() {
    return {
      config: this.getLlmConfig(),
      defaults: {
        reasoningModelId: DEFAULT_REASONING_MODEL_ID,
        evaluationModelId: DEFAULT_EVALUATION_MODEL_ID,
        geography: DEFAULT_GEOGRAPHY,
      },
      models: ALL_MODELS.map(m => ({
        id: m.id,
        label: m.label,
        tier: m.tier,
        description: m.description,
        supportsPromptCaching: m.supportsPromptCaching,
      })),
    };
  }

  async update(patch: Partial<Record<string, string>>): Promise<void> {
    // Validate LLM fields before persisting.
    if (patch.BEDROCK_GEOGRAPHY !== undefined) {
      const g = sanitizeGeography(patch.BEDROCK_GEOGRAPHY);
      if (!g) throw new Error(`Invalid geography: ${patch.BEDROCK_GEOGRAPHY}`);
      patch.BEDROCK_GEOGRAPHY = g;
    }
    if (patch.BEDROCK_REASONING_MODEL !== undefined) {
      const m = sanitizeModelId(patch.BEDROCK_REASONING_MODEL);
      if (!m) throw new Error(`Unknown reasoning model: ${patch.BEDROCK_REASONING_MODEL}`);
      patch.BEDROCK_REASONING_MODEL = m;
    }
    if (patch.BEDROCK_EVALUATION_MODEL !== undefined) {
      const m = sanitizeModelId(patch.BEDROCK_EVALUATION_MODEL);
      if (!m) throw new Error(`Unknown evaluation model: ${patch.BEDROCK_EVALUATION_MODEL}`);
      patch.BEDROCK_EVALUATION_MODEL = m;
    }

    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined && v !== "") {
        (this.map as Record<string, string>)[k] = v;
      }
    }
    await this.store?.write(this.map as Record<string, string>);
    this.rebuildClients();
    this.propagateClients();
  }

  registerServices(services: ServiceRefs): void {
    this.services = services;
  }

  getBrokerAdapter(): BrokerAdapter {
    if (!this.brokerAdapter) {
      throw new Error("Broker credentials not configured. Please set them via the Settings tab.");
    }
    return this.brokerAdapter;
  }

  /**
   * Returns the shared Bedrock client. Lazily constructed so that region
   * changes from the settings UI take effect on the next call.
   */
  getBedrockClient(): AnthropicBedrock {
    if (!this.bedrockClient) {
      this.bedrockClient = buildBedrockClient(this.llmConfig.region);
    }
    return this.bedrockClient;
  }

  private rebuildClients(): void {
    // Rebuild the LLM config from the merged map.
    this.llmConfig = {
      region: this.map.AWS_REGION ?? DEFAULT_LLM_CONFIG.region,
      geography: (sanitizeGeography(this.map.BEDROCK_GEOGRAPHY) ?? DEFAULT_LLM_CONFIG.geography) as BedrockGeography,
      reasoningModelId: sanitizeModelId(this.map.BEDROCK_REASONING_MODEL) ?? DEFAULT_LLM_CONFIG.reasoningModelId,
      evaluationModelId: sanitizeModelId(this.map.BEDROCK_EVALUATION_MODEL) ?? DEFAULT_LLM_CONFIG.evaluationModelId,
    };

    // Force a fresh Bedrock client — region or credential chain may have changed.
    this.bedrockClient = null;

    const broker = this.map.broker ?? "dhan";
    if (this.map.DHAN_ACCESS_TOKEN && this.map.DHAN_CLIENT_ID) {
      try {
        this.brokerAdapter = createBrokerAdapter(broker, this.map as Record<string, string>);
      } catch {
        this.brokerAdapter = null;
      }
    } else {
      this.brokerAdapter = null;
    }
  }

  private propagateClients(): void {
    if (this.brokerAdapter) {
      this.services.heartbeat?.setBrokerAdapter(this.brokerAdapter);
    }
  }
}

export const credentialsStore = new AppCredentialsStore();
export function getBrokerAdapter(): BrokerAdapter { return credentialsStore.getBrokerAdapter(); }
export function getBedrockClient(): AnthropicBedrock { return credentialsStore.getBedrockClient(); }
export function getLlmConfig(): LlmConfig { return credentialsStore.getLlmConfig(); }
// Backward compat alias (used in chat.ts, status.ts, approvals.ts)
export function getDhanClient(): BrokerAdapter { return credentialsStore.getBrokerAdapter(); }

// Surface the types we added above; downstream callers should import these
// from here so swapping back to Anthropic direct-call would be a one-line change.
export type { BrokerCredentialKey, CredentialsMap };
