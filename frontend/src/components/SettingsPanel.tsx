"use client";

import { useEffect, useMemo, useState } from "react";
import { useSettings, type LlmModelInfo } from "../hooks/useSettings";
import { getBackendHttpUrl } from "@/lib/backend-url";

/**
 * Broker credentials continue to be entered manually — broker tokens don't
 * have an equivalent to the AWS default credential chain. LLM configuration
 * is rendered separately below.
 */
const BROKER_FIELDS: { key: "DHAN_ACCESS_TOKEN" | "DHAN_CLIENT_ID"; label: string; description: string }[] = [
  { key: "DHAN_ACCESS_TOKEN", label: "Dhan Access Token", description: "Authenticates with Dhan brokerage" },
  { key: "DHAN_CLIENT_ID", label: "Dhan Client ID", description: "Your Dhan account client ID" },
];

const GEOGRAPHIES: { id: "us" | "eu" | "apac"; label: string; hint: string }[] = [
  { id: "us", label: "United States", hint: "us-east-1 / us-west-2" },
  { id: "eu", label: "Europe", hint: "eu-west-1 / eu-central-1" },
  { id: "apac", label: "Asia Pacific", hint: "ap-south-1 / ap-northeast-1" },
];

function ConfiguredBadge({ configured, label }: { configured: boolean; label?: string }) {
  return configured ? (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-900/40 text-green-400 border border-green-800/40">
      {label ?? "Configured"}
    </span>
  ) : (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-900/40 text-red-400 border border-red-800/40">
      {label ?? "Not set"}
    </span>
  );
}

function CredentialRow({
  label,
  description,
  fieldKey,
  configured,
  onSave,
}: {
  label: string;
  description: string;
  fieldKey: string;
  configured: boolean;
  onSave: (key: string, value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!value.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(fieldKey, value.trim());
      setValue("");
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="py-3 border-b border-gray-800 last:border-0">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white">{label}</span>
            <ConfiguredBadge configured={configured} />
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        </div>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="ml-4 text-xs text-[#4DFF4D] hover:text-[#6fff6f] flex-shrink-0"
          >
            {configured ? "Update" : "Set"}
          </button>
        )}
      </div>

      {editing && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Enter new value"
            autoFocus
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#4DFF4D]"
          />
          <button
            onClick={handleSave}
            disabled={saving || !value.trim()}
            className="px-3 py-1.5 rounded-lg bg-[#4DFF4D] hover:bg-[#6fff6f] disabled:opacity-50 text-gray-900 text-xs font-medium transition-colors"
          >
            {saving ? "..." : "Save"}
          </button>
          <button
            onClick={() => { setEditing(false); setValue(""); setError(null); }}
            className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

function ModelPicker({
  label,
  description,
  value,
  models,
  onChange,
  saving,
}: {
  label: string;
  description: string;
  value: string;
  models: LlmModelInfo[];
  onChange: (id: string) => Promise<void>;
  saving: boolean;
}) {
  const selected = models.find(m => m.id === value);
  return (
    <div className="py-3 border-b border-gray-800 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-white">{label}</div>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        </div>
        <select
          value={value}
          disabled={saving}
          onChange={(e) => { void onChange(e.target.value); }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-[#4DFF4D] min-w-[14rem]"
        >
          {models.map(m => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      {selected && (
        <p className="mt-2 text-xs text-gray-500">
          {selected.description}
          {selected.supportsPromptCaching && (
            <span className="ml-2 text-[#4DFF4D]">· prompt caching enabled</span>
          )}
        </p>
      )}
    </div>
  );
}

interface TestResult {
  role: "reasoning" | "evaluation";
  modelId: string;
  bedrockModelId: string;
  ok: boolean;
  error?: string;
}

interface UsageSummary {
  totals: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    errors: number;
  };
  byPurpose: Record<string, { calls: number; inputTokens: number; outputTokens: number }>;
  byModel: Record<string, { calls: number; inputTokens: number; outputTokens: number }>;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

export function SettingsPanel({ onSaved }: { onSaved?: () => void } = {}) {
  const { status, allConfigured, loading, llm, save } = useSettings();
  const [savingLlm, setSavingLlm] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [regionDraft, setRegionDraft] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; results: TestResult[] } | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  useEffect(() => {
    if (llm) setRegionDraft(llm.config.region);
  }, [llm]);

  const models = llm?.models ?? [];
  const tradingCapableModels = useMemo(
    // The chat + reasoning-job loop relies on tool-calling. Nova Lite on
    // Bedrock doesn't support Anthropic-style tool use — filter it out of
    // the reasoning dropdown so users can't pick an unusable model by accident.
    () => models.filter(m => m.tier !== "nova"),
    [models]
  );

  async function handleSaveField(key: string, value: string) {
    await save({ [key]: value } as Parameters<typeof save>[0]);
    onSaved?.();
  }

  async function handleLlmChange(patch: Parameters<typeof save>[0]) {
    setSavingLlm(true);
    setLlmError(null);
    try {
      await save(patch);
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : "Failed to save LLM settings");
    } finally {
      setSavingLlm(false);
    }
  }

  async function handleTestBedrock() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${getBackendHttpUrl()}/api/settings/test-bedrock`, { method: "POST" });
      const data = (await res.json()) as { ok: boolean; results: TestResult[] };
      setTestResult(data);
    } catch (err) {
      setTestResult({
        ok: false,
        results: [{ role: "reasoning", modelId: "-", bedrockModelId: "-", ok: false, error: err instanceof Error ? err.message : String(err) }],
      });
    } finally {
      setTesting(false);
    }
  }

  async function loadUsage() {
    try {
      const res = await fetch(`${getBackendHttpUrl()}/api/settings/llm-usage?limit=10`);
      if (!res.ok) return;
      const data = (await res.json()) as UsageSummary;
      setUsage(data);
    } catch { /* ignore */ }
  }

  useEffect(() => { void loadUsage(); }, []);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Bedrock / LLM configuration */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-white mb-1">Claude on Amazon Bedrock</h2>
        <p className="text-xs text-gray-500 mb-4">
          VibeTrade calls Claude via Amazon Bedrock. AWS credentials come from your local default chain
          (<code className="text-gray-400">~/.aws/credentials</code>, SSO, env vars, IAM role — whichever is configured).
          No keys are stored in the app.
        </p>

        {loading || !llm ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <>
            <div className="py-3 border-b border-gray-800">
              <label className="text-sm font-medium text-white">AWS Region</label>
              <p className="text-xs text-gray-500 mt-0.5 mb-2">
                Region passed to the Bedrock SDK. Must permit the selected geography&apos;s CRIS profile.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={regionDraft}
                  onChange={(e) => setRegionDraft(e.target.value)}
                  placeholder="us-east-1"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#4DFF4D]"
                />
                <button
                  onClick={() => { void handleLlmChange({ AWS_REGION: regionDraft.trim() }); }}
                  disabled={savingLlm || !regionDraft.trim() || regionDraft.trim() === llm.config.region}
                  className="px-3 py-1.5 rounded-lg bg-[#4DFF4D] hover:bg-[#6fff6f] disabled:opacity-50 text-gray-900 text-xs font-medium transition-colors"
                >
                  {savingLlm ? "…" : "Save"}
                </button>
              </div>
            </div>

            <div className="py-3 border-b border-gray-800">
              <label className="text-sm font-medium text-white">CRIS Geography</label>
              <p className="text-xs text-gray-500 mt-0.5 mb-2">
                Bedrock Cross-Region Inference profile. Requests are routed to the best region within the geography for latency and availability.
              </p>
              <div className="grid grid-cols-3 gap-2">
                {GEOGRAPHIES.map(g => (
                  <button
                    key={g.id}
                    onClick={() => { void handleLlmChange({ BEDROCK_GEOGRAPHY: g.id }); }}
                    disabled={savingLlm}
                    className={`p-2 rounded-lg border text-left transition-colors ${
                      llm.config.geography === g.id
                        ? "border-[#4DFF4D] bg-[#4DFF4D]/10 text-white"
                        : "border-gray-700 hover:border-gray-500 text-gray-300"
                    }`}
                  >
                    <div className="text-xs font-medium">{g.label}</div>
                    <div className="text-[10px] text-gray-500">{g.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            <ModelPicker
              label="Reasoning Model"
              description="Powers chat and reasoning jobs. Sonnet recommended for balance of quality and cost."
              value={llm.config.reasoningModelId}
              models={tradingCapableModels}
              onChange={(id) => handleLlmChange({ BEDROCK_REASONING_MODEL: id })}
              saving={savingLlm}
            />

            <ModelPicker
              label="Evaluation Model"
              description="Powers LLM trigger conditions and sentiment checks. Haiku is the cost-effective default."
              value={llm.config.evaluationModelId}
              models={models}
              onChange={(id) => handleLlmChange({ BEDROCK_EVALUATION_MODEL: id })}
              saving={savingLlm}
            />

            {llmError && <p className="mt-2 text-xs text-red-400">{llmError}</p>}

            <div className="mt-4 pt-3 border-t border-gray-800 flex items-center gap-3">
              <button
                onClick={handleTestBedrock}
                disabled={testing}
                className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-200 text-xs font-medium transition-colors"
              >
                {testing ? "Testing…" : "Test Bedrock access"}
              </button>
              {testResult && (
                <div className="flex-1">
                  <div className="text-xs">
                    {testResult.ok ? (
                      <span className="text-green-400">Both models responded successfully.</span>
                    ) : (
                      <span className="text-red-400">One or more tests failed.</span>
                    )}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {testResult.results.map((r, i) => (
                      <div key={i} className="text-[11px] text-gray-500">
                        <span className={r.ok ? "text-green-400" : "text-red-400"}>
                          {r.ok ? "✓" : "✗"}
                        </span>{" "}
                        <span className="text-gray-300">{r.role}</span> → {r.modelId}
                        {r.error && <span className="text-red-400"> — {r.error}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Broker credentials */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-white mb-1">Broker credentials</h2>
        <p className="text-xs text-gray-500 mb-4">
          Stored at <code className="text-gray-400">~/.vibetrade/credentials.json</code> (or <code className="text-gray-400">VIBETRADE_DATA_DIR</code>).
        </p>

        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <div>
            {BROKER_FIELDS.map(({ key, label, description }) => (
              <CredentialRow
                key={key}
                label={label}
                description={description}
                fieldKey={key}
                configured={status[key]}
                onSave={handleSaveField}
              />
            ))}
          </div>
        )}
      </div>

      {/* Broker selector (unchanged, informational) */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-white mb-1">Broker</h2>
        <div className="flex items-center justify-between">
          <div>
            <select
              value="dhan"
              disabled
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
            >
              <option value="dhan">Dhan</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">More brokers coming soon</p>
          </div>
        </div>
      </div>

      {/* LLM usage snapshot */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">Bedrock usage</h2>
          <button
            onClick={() => { void loadUsage(); }}
            className="text-xs text-gray-400 hover:text-white"
          >
            Refresh
          </button>
        </div>
        {!usage || usage.totals.calls === 0 ? (
          <p className="text-xs text-gray-500">No Bedrock calls recorded yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="text-center p-2 bg-gray-800/50 rounded-lg">
                <div className="text-lg font-semibold text-white">{usage.totals.calls}</div>
                <div className="text-[10px] text-gray-500 uppercase">Calls</div>
              </div>
              <div className="text-center p-2 bg-gray-800/50 rounded-lg">
                <div className="text-lg font-semibold text-white">{formatTokens(usage.totals.inputTokens)}</div>
                <div className="text-[10px] text-gray-500 uppercase">Input tokens</div>
              </div>
              <div className="text-center p-2 bg-gray-800/50 rounded-lg">
                <div className="text-lg font-semibold text-white">{formatTokens(usage.totals.outputTokens)}</div>
                <div className="text-[10px] text-gray-500 uppercase">Output tokens</div>
              </div>
            </div>

            {(usage.totals.cacheReadTokens > 0 || usage.totals.cacheWriteTokens > 0) && (
              <div className="text-xs text-gray-400 mb-3">
                Prompt cache:{" "}
                <span className="text-[#4DFF4D]">{formatTokens(usage.totals.cacheReadTokens)}</span> read · {" "}
                <span className="text-gray-300">{formatTokens(usage.totals.cacheWriteTokens)}</span> written
              </div>
            )}

            <div className="text-xs text-gray-400 space-y-1">
              {Object.entries(usage.byPurpose)
                .filter(([, v]) => v.calls > 0)
                .map(([purpose, v]) => (
                  <div key={purpose} className="flex justify-between">
                    <span>{purpose}</span>
                    <span>
                      {v.calls} calls · {formatTokens(v.inputTokens + v.outputTokens)} tokens
                    </span>
                  </div>
                ))}
            </div>
          </>
        )}
      </div>

      {/* Connection summary */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-white mb-3">Connection status</h2>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">Dhan brokerage</span>
            <ConfiguredBadge configured={status.DHAN_ACCESS_TOKEN && status.DHAN_CLIENT_ID} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">All broker credentials</span>
            <ConfiguredBadge configured={allConfigured} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">Bedrock models (last test)</span>
            <ConfiguredBadge
              configured={testResult?.ok === true}
              label={testResult === null ? "Untested" : testResult.ok ? "Reachable" : "Failed"}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
