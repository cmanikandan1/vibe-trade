<div align="center">

# Vibe Trade

**Your portfolio. Your strategy. Running itself.**

Vibe Trade is a local AI trading agent powered by Claude on Amazon Bedrock. Describe your strategy in plain English — the agent writes the Playbook, builds the automation stack, monitors the market around the clock, and comes to you with a reasoned case before touching your account.

[![License: MIT](https://img.shields.io/badge/license-MIT-4DFF4D?labelColor=111)](LICENSE)
[![Powered by Claude on Amazon Bedrock](https://img.shields.io/badge/Claude%20on-Amazon%20Bedrock-4DFF4D?labelColor=111)](https://aws.amazon.com/bedrock/)

[How it works](#how-it-works) · [Prerequisites](#prerequisites) · [Quickstart](#quickstart) · [Roadmap](#roadmap)

</div>

> **Fork notice:** This is a fork of the original [vibetrade-ai/vibe-trade](https://github.com/vibetrade-ai/vibe-trade) project. This fork replaces the direct Anthropic API integration with Amazon Bedrock, adds Cross-Region Inference (CRIS), configurable model selection per workload, prompt caching, structured usage logging, and a Bedrock connectivity test. See [ADR 013](ADR/013-bedrock-migration.md) for details.

---

<div align="center">

![Vibe Trade Demo](assets/demo.gif)

</div>

---

## Talk to your portfolio — with live data

Ask the agent anything. It has 20 built-in tools and a live broker connection. It fetches real prices, reads your open positions, pulls candles and indicators, and scans the news — then answers like a portfolio manager who's been watching all morning.

```
you:   what's the weakest position right now?

agent: ONGC SHORT is the most at risk. RSI has climbed to 56 —
       short momentum is fading. You're at −1.02% with the hard
       SL only ₹1.29 away. Want me to queue an exit?
```

No stale training data. No hallucinated prices. Every answer grounded in what's actually happening right now.

---

## Write a strategy once. Run it forever.

Describe your thesis in plain English. The agent shapes it into a **Playbook** — entry rules, exit criteria, capital allocation, guardrails — and from that point, every decision it makes is anchored to that document.

```
you:   Intraday momentum strategy, long and short. Three concurrent
       positions across Nifty 100 stocks. ₹9,000 deployed. No new
       entries after 2:30pm. Honour my stop-losses.

agent: Here's what I've drafted as "Aggressive Alpha":
       [Playbook document — entry signals, position sizing, SL/target
        rules, EOD close logic, capital per slot]
       Ready to activate?
```

Same rules. Every session. No drift, no forgotten instructions, consistent P&L tracking against the thesis.

---

## The agent builds its own automation stack

When a position opens, the agent immediately registers the full set of triggers to manage it — stop-losses, targets, trailing stops, monitors, re-entry scanners. You describe the risk model once in the Playbook. The agent wires it up.

```
Aggressive Alpha — triggers registered after opening 3 positions:

  ✓ HINDALCO SL          hard_order  BUY MARKET    price ≥ ₹964
  ✓ HINDALCO Target      hard_order  BUY MARKET    price ≤ ₹948
  ✓ HINDALCO Trail       reasoning   move SL       price ≤ ₹938
  ✓ ONGC SL              hard_order  BUY MARKET    price ≥ ₹273.04
  ✓ Nifty Drop Guard     reasoning   review longs  nifty_drop ≥ 1%
  ✓ Correlated Drawdown  reasoning   review all    2+ positions > −0.75%
  ✓ Position Monitor     reasoning   VWAP + RSI    every 30 min
  ✓ EOD Hard Close       reasoning   close all     15:10 daily
```

---

## Always watching. Only thinking when it matters.

**Heartbeat** monitors your positions and triggers every 30 seconds — without running the LLM. Price conditions are evaluated in pure JavaScript. Cron handles time-based triggers. The expensive model only wakes up when something actually fires.

```
09:00  ──  tick  3 positions · 10 triggers evaluated  →  0 fired
09:30  ──  tick  Position Monitor fired  →  reasoning_job started
09:31  ──  agent queued 2 approval(s)
10:00  ──  tick  3 positions · 10 triggers evaluated  →  0 fired
10:30  ──  tick  Position Monitor fired  →  reasoning_job started
10:31  ──  agent queued 2 approval(s)
15:10  ──  EOD Hard Close fired  →  all positions squared off
```

---

## Nothing happens without your say-so

Before any order is placed, the agent submits a structured approval card — not a chat message. The exact trade, and every signal that led to the recommendation. You approve or reject. The gate is code-level; there is no way around it.

```
  APPROVAL REQUEST · Aggressive Alpha — Position Monitor
  ────────────────────────────────────────────────────────
  SELL · ONGC · 11 shares · MARKET ORDER · Close SHORT
  Entry ₹269.00   LTP ₹271.75   Unrealised −₹30.25

  🔴 3 EXIT SIGNALS FIRED

  SIGNAL 1 — RSI DETERIORATION
  RSI risen to 56.52, crossing the 55 ceiling for short momentum.
  Buyers are stepping in. Downside thesis is losing steam.

  SIGNAL 2 — HIGH-VOLUME RECOVERY
  Last two candles (179K, 260K vol) show price bouncing off lows.
  A short needs sellers in control. This shows the opposite.

  SIGNAL 3 — POST-1PM LOSS, NO CATALYST
  13:30 IST. Down −1.02% with hard SL only ₹1.29 away. Holding
  risks the full −1.5% loss; exiting now saves ~₹5.30/share.

  [ ✓ Approve ]  [ ✗ Reject ]
```

Three consent modes — **in-chat** (you're present), **async** (agent queues while you're away), **autonomous** (within guardrails you define upfront in the Playbook).

---

## Every decision on record. Permanently.

Every trade is written to an immutable journal with the agent's reasoning at the moment of decision — not a post-hoc summary. Every trigger run is logged, including runs where no trade was placed. Ask the agent to explain any past decision and it has the full context.

```json
{
  "symbol": "ONGC",
  "transactionType": "SELL",
  "quantity": 11,
  "executedPrice": 269.00,
  "note": "Slot B SHORT. Below VWAP all session, RSI 45 falling,
           MACD negative, weak oil sector on bearish day.
           SL: ₹273.04 · Target: ₹262.28",
  "filledAt": "2026-03-11 10:19:12"
}
```

---

## Claude on Amazon Bedrock

All model calls go through Amazon Bedrock. No direct Anthropic API keys.

- **Default credential chain.** AWS credentials are picked up from env vars, `~/.aws/credentials`, SSO, or your IAM role. Nothing hardcoded.
- **Cross-Region Inference (CRIS).** Pick a geography (US / EU / APAC) and Bedrock routes each call to the healthiest region within it.
- **Two configurable models per workload:**
  - *Reasoning model* — chat and reasoning jobs. Default: Claude Sonnet 4.5.
  - *Evaluation model* — LLM trigger conditions and sentiment checks. Default: Claude Haiku 4.5.
- **Prompt caching** on the large, stable system prompts — typically halves the input-token bill on multi-turn reasoning jobs.
- **Structured usage logging.** Every call records model, region, latency, input/output tokens, and prompt-cache hits to `~/.vibetrade/llm-usage.jsonl`. Aggregated totals are visible in the Settings tab.
- **"Test Bedrock access" button.** One click validates both configured models end-to-end — catches misconfigured IAM, missing model access, or wrong region before market hours.

---

## How it works

Vibe Trade is built on six primitives. Each one solves a problem an LLM can't solve on its own.

```
Heartbeat → snapshot → Trigger fires → Playbook loaded
  → LLM reasons → Permissions gate → Trade placed → Learnings logs
```

| # | Primitive | What it gives the agent |
|---|-----------|------------------------|
| 01 | **Market Tooling** | 20 tools — live quotes, candles, indicators, fundamentals, news, order book, broker execution |
| 02 | **Heartbeat** | 30s monitoring loop — evaluates all trigger conditions without running the LLM |
| 03 | **Triggers** | Condition + action. Modes: `code` `event` `time` `llm`. Types: `hard_order` `reasoning_job` |
| 04 | **Permissions** | Code-level approval gate — three consent modes, full audit trail |
| 05 | **Playbooks** | Persistent strategy document — consistent identity, isolated P&L, capital bounds |
| 06 | **Learnings** | Immutable trade journal — reasoning captured at decision time, not reconstructed after |
| 07 | **Skills** | Reusable instruction modules per Playbook _(coming soon)_ |

---

## Prerequisites

Before running Vibe Trade, make sure you have the following set up and working on your machine.

### 1. Node.js >= 20

Vibe Trade requires Node.js version 20 or later.

```bash
# Check your version
node --version
# Should print v20.x.x or higher
```

Install from [nodejs.org](https://nodejs.org/) or use a version manager like `nvm`:

```bash
nvm install 20
nvm use 20
```

### 2. AWS CLI installed and configured

The backend calls Claude models through Amazon Bedrock, which requires valid AWS credentials. Credentials are resolved via the standard AWS credential chain -- you do not hardcode keys in the app.

**Supported credential methods (any one of these):**

| Method | How to set up |
|--------|---------------|
| Environment variables | Export `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and optionally `AWS_SESSION_TOKEN` |
| Shared credentials file | Run `aws configure` to populate `~/.aws/credentials` |
| AWS SSO | Run `aws sso login --profile your-profile` |
| IAM instance role | Automatically available on EC2 / ECS / Lambda |

**Verify credentials are working:**

```bash
aws sts get-caller-identity
# Should return your Account, UserId, and Arn without errors
```

If this command fails, Bedrock calls will also fail. Fix your credentials first.

### 3. Amazon Bedrock access enabled

Your AWS account must have Amazon Bedrock enabled in the region you plan to use (default: `us-east-1`).

1. Open the [Amazon Bedrock console](https://console.aws.amazon.com/bedrock/).
2. Select your target region from the region dropdown.
3. If prompted, request access to the Bedrock service.

### 4. Bedrock model access for Anthropic Claude

Vibe Trade uses two model slots -- a **reasoning model** (default: Claude Sonnet 4.5) and an **evaluation model** (default: Claude Haiku 4.5). You must explicitly enable access to these models in the Bedrock console.

1. In the [Bedrock console](https://console.aws.amazon.com/bedrock/), go to **Model access** (left sidebar).
2. Click **Manage model access**.
3. Enable the following Anthropic models (at minimum):
   - **Claude Haiku 4.5** (used for trigger evaluation)
   - **Claude Sonnet 4.5** (used for chat and reasoning jobs)
   - **Claude Opus 4.1** (optional, for deep analysis)
4. Wait for the status to show "Access granted" before proceeding.

**Verify model access:**

Once the app is running, click **Test Bedrock access** in the Settings tab. This validates both configured models end-to-end and catches IAM issues, missing model access, or wrong-region problems before market hours.

### 5. Dhan trading account with API credentials

Vibe Trade connects to the [Dhan](https://dhan.co/) broker for live market data and order execution. You need:

- A Dhan trading account (sign up at [dhan.co](https://dhan.co/))
- An **API access token** and **client ID** from the [Dhan Developer Portal](https://dhanhq.co/docs/v2/)

You can add these credentials in one of two ways:

- **Via the UI:** Navigate to `http://localhost:3001/settings` after starting the server and enter them there.
- **Via environment variables:** Set `DHAN_ACCESS_TOKEN` and `DHAN_CLIENT_ID` in `backend/.env` (copy from `backend/.env.example`).

### 6. Summary checklist

| # | Prerequisite | Verify with |
|---|---|---|
| 1 | Node.js >= 20 | `node --version` |
| 2 | AWS credentials configured | `aws sts get-caller-identity` |
| 3 | Bedrock service enabled in target region | Check Bedrock console |
| 4 | Claude model access granted | "Test Bedrock access" button in Settings |
| 5 | Dhan API credentials | Log in to Dhan Developer Portal |

---

## Quickstart

**Requirements**

| Dependency | |
|------------|--|
| Node.js ≥ 20 | Runtime |
| AWS account with Amazon Bedrock access | Uses your local AWS default credential chain (env vars, `~/.aws/credentials`, SSO, IAM role). |
| Bedrock model access | Enable Anthropic Claude Haiku / Sonnet / Opus in your Bedrock console for the target region. |
| Dhan account | Broker — credentials added at `/settings` |

### Configure LLM access

From the Settings tab you can pick:

- **AWS region** (default `us-east-1`).
- **CRIS geography** — US, EU, or APAC.
- **Reasoning model** — Claude Sonnet 4.5 (default), Haiku, or Opus.
- **Evaluation model** — Claude Haiku 4.5 (default) or a higher tier.

Click **Test Bedrock access** to verify both models before going live. The **Bedrock usage** panel shows live aggregate consumption (calls, tokens, prompt-cache hits) so you can track cost.

### Configure broker access

Add your Dhan credentials at `http://localhost:3001/settings` once the server is running. Vibe Trade is designed to support multiple brokers — we're starting with **Dhan**, more are on the roadmap.

Everything runs on your machine. Your AWS credentials, broker credentials, trade history, and Playbooks never leave your local environment — stored in `~/.vibetrade/`.

> **Start with chat before automation.** Ask the agent to look at your positions, fetch a quote, explain a stock's technicals. Once you're comfortable with how it reasons and what tools it has, give it a Playbook and let it run.

---

## Roadmap

- [x] Market Tooling — 20 built-in tools, Dhan broker
- [x] Heartbeat — 30s monitoring loop
- [x] Triggers — `code`, `event`, `time`, `llm` conditions
- [x] Permissions — in-chat and autonomous consent
- [x] Playbooks — persistent strategy documents
- [x] Learnings — immutable trade journal
- [x] Amazon Bedrock integration with CRIS, prompt caching, usage logging
- [ ] Bedrock Guardrails integration
- [ ] Model fallback (retry on Haiku when Sonnet throttles)
- [ ] Per-request token budget caps
- [ ] Skills — reusable markdown files that teach the agent a technique
- [ ] Async approvals — WhatsApp / Telegram
- [ ] Additional brokers
- [ ] Hosted mode — always-on Heartbeat

---

## Attribution

Vibe Trade is a fork of the original project by the vibetrade-ai team:
**[github.com/vibetrade-ai/vibe-trade](https://github.com/vibetrade-ai/vibe-trade)**. The upstream project is the source of the core architecture — Heartbeat, Triggers, Playbooks, Permissions, Learnings. This fork adds the Amazon Bedrock integration and related operational features listed above.
