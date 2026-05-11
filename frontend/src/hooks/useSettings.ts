"use client";

import { useCallback, useEffect, useState } from "react";
import { getBackendHttpUrl } from "@/lib/backend-url";

/** Broker credential flags — AWS creds are NOT managed here (use default chain). */
export interface CredentialStatus {
  DHAN_ACCESS_TOKEN: boolean;
  DHAN_CLIENT_ID: boolean;
}

export interface LlmModelInfo {
  id: string;
  label: string;
  tier: "haiku" | "sonnet" | "opus" | "nova" | "llama";
  description: string;
  supportsPromptCaching: boolean;
}

export interface LlmConfigView {
  region: string;
  geography: "us" | "eu" | "apac";
  reasoningModelId: string;
  evaluationModelId: string;
}

export interface LlmSettingsView {
  config: LlmConfigView;
  defaults: {
    reasoningModelId: string;
    evaluationModelId: string;
    geography: "us" | "eu" | "apac";
  };
  models: LlmModelInfo[];
}

interface SettingsState {
  loading: boolean;
  allConfigured: boolean;
  status: CredentialStatus;
  broker: string;
  llm: LlmSettingsView | null;
}

export type SettingsPatch = Partial<{
  DHAN_ACCESS_TOKEN: string;
  DHAN_CLIENT_ID: string;
  AWS_REGION: string;
  BEDROCK_GEOGRAPHY: "us" | "eu" | "apac";
  BEDROCK_REASONING_MODEL: string;
  BEDROCK_EVALUATION_MODEL: string;
}>;

export function useSettings() {
  const [state, setState] = useState<SettingsState>({
    loading: true,
    allConfigured: false,
    status: { DHAN_ACCESS_TOKEN: false, DHAN_CLIENT_ID: false },
    broker: "dhan",
    llm: null,
  });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${getBackendHttpUrl()}/api/settings`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        status: CredentialStatus;
        allConfigured: boolean;
        broker?: string;
        llm: LlmSettingsView;
      };
      setState({
        loading: false,
        allConfigured: data.allConfigured,
        status: data.status,
        broker: data.broker ?? "dhan",
        llm: data.llm,
      });
    } catch {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  const save = useCallback(
    async (patch: SettingsPatch) => {
      const res = await fetch(`${getBackendHttpUrl()}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: "Unknown error" }))) as { error: string };
        throw new Error(err.error ?? "Failed to save settings");
      }
      await refresh();
      window.dispatchEvent(new Event("credentials-updated"));
    },
    [refresh]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh, save };
}
