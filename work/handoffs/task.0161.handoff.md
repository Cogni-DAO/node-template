---
id: task.0161.handoff
type: handoff
work_item_id: task.0161
status: active
created: 2026-03-12
updated: 2026-03-12
branch: feat/governance-integration
last_commit: b4b0cd49
---

# Handoff: Governance Signal Execution — Admin App Signal Listening + Handling

## What Was Done (PR #549 — squash-merged to staging)

Three formerly separate repos consolidated into cogni-template:

1. **PR Review** (from cogni-git-review) — already ported before this work
2. **Proposal Launcher** (from cogni-proposal-launcher) — public `/propose/merge` page
3. **Signal Executor** (from cogni-git-admin) — Alchemy webhook → RPC verify → GitHub action

The full governance loop works end-to-end in code:

```
PR fails review → deep link in Check Run summary
  → /propose/merge?dao=...&plugin=...&signal=...&chainId=...&repoUrl=...&pr=...
  → user connects wallet, creates Aragon proposal
  → DAO votes (3-day period)
  → proposal passes → CogniSignal.execute() → CogniAction event on-chain
  → Alchemy webhook → /api/internal/webhooks/alchemy
  → signal handler: RPC re-verify → decode → validate chain/dao vs repo-spec → merge PR
```

### What's NOT done yet

- **Not deployed** — no Alchemy webhook subscription, no env vars set, `base_url` is still `localhost`
- **No e2e test** — task.0159 is `needs_design`
- **No admin UI for signals** — `/gov` page shows epoch/credit/activity status but has zero signal execution visibility
- **In-memory tx dedup** — resets on deploy (Walk phase: DB-backed)

## Architecture of the Signal Pipeline

### Complete file map

| Layer | File | Role |
|-------|------|------|
| **Webhook route** | `src/app/api/internal/webhooks/[source]/route.ts` | POST handler; HMAC verify; calls `dispatchSignalExecution()` fire-and-forget |
| **Dispatch** | `src/features/governance/services/signal-dispatch.ts` | Resolves deps (RPC client, Octokit factory, DAO config); dispatches per-tx |
| **Handler** | `src/features/governance/services/signal-handler.ts` | Orchestrator: dedup → RPC fetch → decode → validate → execute |
| **Parser** | `src/features/governance/signal-parser.ts` | Decodes `CogniAction` event log → `Signal` type (Zod-validated) |
| **Actions** | `src/features/governance/actions.ts` | Action registry: `merge:change`, `grant:collaborator`, `revoke:collaborator` |
| **Types** | `src/features/governance/signal-types.ts` | Zod schemas: `signalSchema`, `actionResultSchema`, `Signal`, `ActionResult` |
| **Proposal page** | `src/app/(public)/propose/merge/merge-proposal.client.tsx` | Public page: wallet connect → `createProposal()` tx |
| **Proposal utils** | `src/features/governance/lib/proposal-utils.ts` | URL param validation, gas estimation, timestamp generation |
| **Proposal ABIs** | `src/features/governance/lib/proposal-abis.ts` | `COGNI_SIGNAL_ABI`, `TOKEN_VOTING_ABI` |
| **DAO config** | `src/shared/config/repoSpec.server.ts` → `getDaoConfig()` | Reads `cogni_dao` from `.cogni/repo-spec.yaml` (cached) |
| **Chain config** | `src/shared/web3/chain.ts` | `CHAINS`, `CHAIN_CONFIG`, `CHAIN_ID` (active: Base 8453) |
| **Block explorer** | `src/shared/web3/block-explorer.ts` | `getDaoUrl()` — maps chainId to Aragon network path |
| **Events** | `src/shared/observability/events/index.ts` | `SIGNAL_EXECUTION_COMPLETE`, `SIGNAL_DISPATCH_SKIPPED`, `ADAPTER_EVM_RPC_ERROR` |

### Key types

```typescript
// Signal (parsed from on-chain CogniAction event)
interface Signal {
  dao: string;           // DAO contract address
  chainId: bigint;       // EVM chain ID
  vcs: "github" | "gitlab" | "radicle";
  repoUrl: string;       // https://github.com/owner/repo
  action: "merge" | "grant" | "revoke";
  target: "change" | "collaborator";
  resource: string;      // PR number or GitHub username
  nonce: bigint;
  deadline: number;      // Unix timestamp (0 = no deadline)
  paramsJson: string;    // JSON params for action handler
  executor: string;      // address that executed
}

// ActionResult (returned by action handlers)
interface ActionResult {
  success: boolean;
  action: string;        // e.g. "merge_completed", "merge_failed", "duplicate"
  error?: string;
  sha?: string;          // commit SHA for merge
  username?: string;     // for collaborator ops
  repoUrl?: string;
  changeNumber?: number; // PR number
}
```

### CogniAction Solidity event

```solidity
event CogniAction(
  address indexed dao,
  uint256 indexed chainId,
  string vcs, string repoUrl, string action, string target, string resource,
  bytes extra,  // ABI-encoded: (uint256 nonce, uint64 deadline, string paramsJson)
  address indexed executor
);
```

Topic0: `0x7a3cb36f100df6ecbe1f567f9c30dc11d02d5c42851e8fd534675bb303566a03`

### Invariants (from spec)

- **ON_CHAIN_RE_VERIFY**: Handler fetches tx receipt from RPC; never trusts webhook payload
- **TX_HASH_DEDUP**: In-memory `Set<string>` (lowercase); upgrade to DB in Walk phase
- **DAO_CONFIG_FROM_SPEC**: All contract addresses from `.cogni/repo-spec.yaml`; only `ALCHEMY_WEBHOOK_SECRET` is env var
- **FIRE_AND_FORGET**: Dispatch is async after webhook 200 response; errors logged, never thrown
- **CHAIN_DAO_MATCH**: Signal's chainId + dao must match repo-spec values

## What the Next Agent Should Do

### 1. Deploy the signal execution pipeline

The code is merged but not live. These are the infrastructure steps:

- [ ] **Create Alchemy webhook**: ADDRESS_ACTIVITY subscription monitoring the CogniSignal contract (`0xb87acef56be3ccfc6a71c48fb0a2276ff395d1af` on Base 8453). Target URL: `https://<deployed-url>/api/internal/webhooks/alchemy`
- [ ] **Set env vars** in deployment: `ALCHEMY_WEBHOOK_SECRET` (from Alchemy dashboard) + `EVM_RPC_URL` (Base mainnet RPC)
- [ ] **Update `base_url`** in `.cogni/repo-spec.yaml` from `http://localhost:3000` to the deployed URL (deep links in PR review comments use this)
- [ ] **Configure GitHub App permissions**: add `administration: write` + `contents: write` to the existing review bot app (needed for merge + collaborator actions)
- [ ] **Verify GitHub App installation** on the target repo(s) — `resolveOctokit()` looks up installation ID per repo

For local dev, see `docs/guides/alchemy-webhook-setup.md` (SMEE tunnel for webhook forwarding).

### 2. E2E validation (task.0159)

Once deployed, validate the pipeline end-to-end:

- **Tier 1 (fast)**: POST a captured Alchemy webhook payload (valid HMAC) referencing a real Sepolia CogniAction tx. Assert: HMAC verify → RPC fetch → decode → DAO config check all succeed. GitHub action fails (no matching PR) — expected.
- **Tier 2 (live-fire)**: Create test PR → submit Aragon proposal on Sepolia → wait for vote → verify Alchemy webhook fires → verify PR merges.
- See `work/items/task.0159.governance-e2e-validation.md` for full plan + Sepolia contract addresses.

### 3. Open questions (from `docs/spec/dao-governance-loop.md`)

- DB-backed tx hash dedup (in-memory resets on deploy)
- Nonce replay protection
- GitHub App permission scoping (separate apps for review vs signal?)
- Action result feedback (PR comment on successful merge?)

### Env vars needed for deployment

| Var | Purpose | Where to set |
|-----|---------|--------------|
| `ALCHEMY_WEBHOOK_SECRET` | HMAC verification of Alchemy payloads | Deployment env |
| `EVM_RPC_URL` | viem PublicClient for on-chain reads | Deployment env |
| `GH_REVIEW_APP_ID` | GitHub App for API calls (shared with review bot) | Already set |
| `GH_REVIEW_APP_PRIVATE_KEY_BASE64` | GitHub App private key (shared) | Already set |

### Contract addresses (from `.cogni/repo-spec.yaml`)

**Base mainnet (production):**
- Signal: `0xb87acef56be3ccfc6a71c48fb0a2276ff395d1af`
- DAO: `0x08092cf85fcf8258e55e9db3b3b0afd0f408537e`
- Plugin: `0xe287e723de86348bdeb67af3f1310e6623e24ad4`
- Chain ID: `8453`

**Sepolia (testing — from task.0159):**
- Signal: `0x8f26cf7b9ca6790385e255e8ab63acc35e7b9fb1`
- DAO: `0xB0FcB5Ae33DFB4829f663458798E5e3843B21839`
- Plugin: `0x77BA7C0663b2f48F295E12e6a149F4882404B4ea`

## Specs and Docs to Read

| Document | What it covers |
|----------|---------------|
| `docs/spec/governance-signal-execution.md` | As-built spec — invariants, schemas, component boundaries |
| `docs/spec/dao-governance-loop.md` | Draft e2e spec — open questions live here |
| `docs/design/governance-integration-crawl.md` | Architecture rationale for the consolidation |
| `docs/guides/alchemy-webhook-setup.md` | How to set up Alchemy webhooks + SMEE tunnel for local dev |
| `apps/web/src/features/governance/AGENTS.md` | Feature boundary — exports, routes, allowed changes |

## Related Work Items

| ID | Title | Status | Relevance |
|----|-------|--------|-----------|
| task.0161 | Governance signal executor | done (squash-merged via PR #549) | The code you're deploying and validating |
| task.0159 | Governance e2e test | needs_design | Tier 1: webhook replay test; Tier 2: live-fire smoke test |
| proj.system-tenant-governance | System Tenant & Governance project | Active | Parent project roadmap |

## Risks / Gotchas

- **In-memory dedup resets on deploy**: If Alchemy retries after redeploy, same tx can execute twice. `merge:change` is safe (GitHub merge is idempotent), but `grant:collaborator` is not. DB-backed dedup should be priority.
- **`base_url` is `localhost`**: Deep links in PR review comments point to localhost. Update in repo-spec before deploy.
- **GitHub App permissions**: Must add `administration: write` + `contents: write` to the existing review bot GitHub App. Without these, merge and collaborator actions silently fail.
- **Observability**: Signal handler uses pino directly (not `logEvent()`) because fire-and-forget has no `reqId`. Event names are registered in `EVENT_NAMES`. Don't "fix" this to use `logEvent()` — it's intentional.
- **No `signal.chainId` on Signal type is bigint**: The Zod schema has `chainId: z.bigint()` but repo-spec `chain_id` is a string. The handler does `signal.chainId.toString() !== daoConfig.chain_id` — don't break this comparison.
