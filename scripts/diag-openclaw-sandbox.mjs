#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/diag-openclaw-sandbox`
 * Purpose: Diagnostic script for OpenClaw-in-sandbox via SandboxRunnerAdapter. Tests full flow: workspace setup → adapter.runOnce → parse output.
 * Scope: Standalone diagnostic; not imported by src/. Requires cogni-sandbox-openclaw:latest image, dev stack, LITELLM_MASTER_KEY.
 * Invariants: Uses SandboxRunnerAdapter (same path as graph execution pipeline); container runs with network=none + socket bridge.
 * Side-effects: IO (Docker containers, tmp workspace, proxy lifecycle)
 * Links: docs/spec/openclaw-sandbox-spec.md, src/adapters/server/sandbox/sandbox-runner.adapter.ts
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const OPENCLAW_IMAGE = "cogni-sandbox-openclaw:latest";
const LITELLM_MASTER_KEY = process.env.LITELLM_MASTER_KEY;

if (!LITELLM_MASTER_KEY) {
  console.error(
    "FATAL: LITELLM_MASTER_KEY not set. Start dev stack: pnpm dev:infra"
  );
  process.exit(1);
}

const runId = `diag-oc-${Date.now()}`;
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "diag-openclaw-"));

function ts() {
  return `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;
}
const t0 = Date.now();

console.log(`${ts()} workspace: ${workspace}`);
console.log(`${ts()} runId: ${runId}`);

// ── Step 1: Write OpenClaw config ────────────────────────────────────────────
const openclawDir = path.join(workspace, ".openclaw");
const stateDir = path.join(workspace, ".openclaw-state");
const cogniDir = path.join(workspace, ".cogni");

fs.mkdirSync(openclawDir, { recursive: true });
fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(cogniDir, { recursive: true });

const config = {
  models: {
    mode: "replace",
    providers: {
      cogni: {
        baseUrl: "http://localhost:8080/v1",
        api: "openai-completions",
        apiKey: "proxy-handles-auth",
        models: [
          {
            id: "gemini-2.5-flash",
            name: "Gemini 2.5 Flash",
            reasoning: false,
            input: ["text"],
            contextWindow: 200000,
            maxTokens: 8192,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      },
    },
  },
  agents: {
    defaults: {
      model: { primary: "cogni/gemini-2.5-flash" },
      workspace: "/workspace",
      sandbox: { mode: "off" },
      skipBootstrap: true,
      timeoutSeconds: 60,
    },
    list: [{ id: "main", default: true, workspace: "/workspace" }],
  },
  tools: {
    elevated: { enabled: false },
    deny: [
      "group:web",
      "browser",
      "cron",
      "gateway",
      "nodes",
      "sessions_send",
      "sessions_spawn",
      "message",
    ],
  },
  cron: { enabled: false },
  gateway: { mode: "local" },
};

fs.writeFileSync(
  path.join(openclawDir, "openclaw.json"),
  JSON.stringify(config, null, 2)
);
fs.writeFileSync(
  path.join(cogniDir, "prompt.txt"),
  'Say "hello from sandbox" and nothing else.'
);

console.log(`${ts()} workspace prepared`);

// ── Step 2: Run via SandboxRunnerAdapter ─────────────────────────────────────
const { SandboxRunnerAdapter } = await import(
  "../src/adapters/server/sandbox/sandbox-runner.adapter.ts"
);

const runner = new SandboxRunnerAdapter({
  litellmMasterKey: LITELLM_MASTER_KEY,
});

const cmd = [
  "node /app/dist/index.js agent --local --agent main",
  '--message "$(cat /workspace/.cogni/prompt.txt)"',
  "--json --timeout 55",
].join(" ");

try {
  console.log(`${ts()} running openclaw via SandboxRunnerAdapter...`);
  const result = await runner.runOnce({
    runId,
    workspacePath: workspace,
    image: OPENCLAW_IMAGE,
    argv: [cmd],
    limits: { maxRuntimeSec: 65, maxMemoryMb: 512 },
    networkMode: { mode: "none" },
    llmProxy: {
      enabled: true,
      billingAccountId: "diag-openclaw-test",
      attempt: 0,
      env: {
        HOME: "/workspace",
        OPENCLAW_CONFIG_PATH: "/workspace/.openclaw/openclaw.json",
        OPENCLAW_STATE_DIR: "/workspace/.openclaw-state",
        OPENCLAW_LOAD_SHELL_ENV: "0",
      },
    },
  });

  console.log(
    `${ts()} container exited: ok=${result.ok} code=${result.exitCode}`
  );

  if (result.stderr) {
    console.log(`\n${"=".repeat(60)}`);
    console.log("STDERR:");
    console.log("=".repeat(60));
    console.log(result.stderr.slice(0, 2000));
    console.log("=".repeat(60));
  }

  // Try to parse JSON envelope from stdout
  const raw = result.stdout.trim();
  try {
    const envelope = JSON.parse(raw);
    console.log(`\n${ts()} PARSED ENVELOPE:`);
    console.log(
      `  payloads: ${JSON.stringify(envelope.payloads?.map((p) => p.text?.slice(0, 100)))}`
    );
    console.log(`  error: ${JSON.stringify(envelope.meta?.error)}`);
    console.log(`  duration: ${envelope.meta?.durationMs}ms`);
    console.log(`  model: ${envelope.meta?.agentMeta?.model}`);
    console.log(`  aborted: ${envelope.meta?.aborted}`);
  } catch {
    console.log(`\n${ts()} stdout not valid JSON:`);
    console.log(raw.slice(0, 500));
  }
} catch (err) {
  console.error(`${ts()} runner error:`, err.message);
}

// ── Step 3: Check workspace state ────────────────────────────────────────────
console.log(`\n${ts()} workspace files after run:`);
const walkSync = (dir, prefix = "") => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) walkSync(path.join(dir, entry.name), rel);
    else console.log(`  ${rel}`);
  }
};
walkSync(workspace);

// Cleanup
await runner.dispose();
fs.rmSync(workspace, { recursive: true, force: true });
console.log(`\n${ts()} done.`);
