---
id: attribution-scoring-design
type: research
title: "Design: Attribution Scoring — Thin Ingestion, LLM Evaluation, and Forward Rebalancing"
status: active
trust: draft
summary: "Design reasoning for the attribution scoring model: thin receipt ingestion, LLM-powered contextual evaluation, versioned immutable ledger entries, and forward-only rebalancing."
read_when: Designing evaluation enrichers, planning rebalancing mechanisms, or reasoning about attribution algorithm versioning.
owner: cogni-dev
created: 2026-02-28
verified: null
tags: [governance, attribution, scoring, design]
---

# Attribution Scoring Design

> Receipts are thin pointers. Evaluation is where intelligence lives. The ledger is a journal of best attempts, not a database to update in place.

## Core Philosophy

We are building an accounting journal, not a scoring engine.

Every epoch produces a signed, immutable statement: "given what we knew and the tools
we had at the time, here is how we valued contributions." That statement is a permanent
fact — even if future understanding reveals it was imperfect.

Three principles follow:

1. **Ingestion is thin.** A receipt is a reference to an event: who, what, when, where.
   It does not try to capture everything about the event. It captures enough to find it
   again later.

2. **Evaluation is rich.** The evaluator fetches additional context on-demand — reads
   the actual PR diff, examines the codebase at that point in time, uses an LLM to
   reason about value. The evaluation snapshots everything it consumed, so the scoring
   is reproducible from the evaluation payload alone.

3. **Algorithms are versioned and frozen.** `cogni.ai_scores.v0` is a permanent label.
   When a better model or better prompt exists, that becomes `v1` — it does not retroactively
   replace `v0`. Old epochs keep their original scores. New epochs use new algorithms.
   Corrections flow forward as rebalancing entries, never as rewrites.

We are explicitly admitting that today we don't know how to fairly score everything.
The ledger captures our best attempt at each point in time. Future algorithms with
more context and data can review the historical record and issue corrections — but those
corrections are new signed entries, not edits to old ones.

---

## Design

### Layer 1: Thin Ingestion (existing — no changes)

The GitHub adapter collects lightweight event references:

```
Receipt: {
  id:              "github:pr:org/repo:42"      ← deterministic
  source:          "github"
  eventType:       "pr_merged"
  platformUserId:  "12345"                       ← stable numeric ID
  artifactUrl:     "https://github.com/org/repo/pull/42"
  metadata:        { title, additions, deletions, changedFiles, labels }
  payloadHash:     "sha256:..."
  eventTime:       "2026-02-15T..."
}
```

This is deliberately minimal. The receipt says "PR #42 was merged by user 12345 at
time T." It does not capture the full diff, the file list, the dependency graph, or the
codebase context. Those are the evaluator's job.

**Why thin?** GitHub's GraphQL API is flaky for deep pagination and complex nested queries.
Asking for 100 files per PR across hundreds of PRs within a single paginated connection
is fragile. The adapter's job is to reliably capture event references — a task that
requires only basic PR metadata and is robust against API instability.

The receipt's `artifactUrl` is the hook. Given a URL, the evaluator can fetch whatever
depth of context it needs using the most appropriate tool (REST API for a single PR's
files, git clone for full codebase context, etc.).

### Layer 2: LLM-Powered Evaluation (new enricher — fits existing contract)

This is the intelligence layer. For each epoch's selected receipts, the evaluator:

1. **Reads the receipt references** — gets the list of events to score
2. **Fetches context per event** — for a PR, this means:
   - Fetch the full diff via REST (`GET /repos/{owner}/{repo}/pulls/{n}/files`)
   - Fetch PR conversation/review comments if relevant
   - Optionally: checkout the repo at the merge commit for broader codebase context
3. **Scores with an LLM** — given the event data and codebase context, the LLM
   produces a score and reasoning for each event
4. **Snapshots everything** — the evaluation payload contains all inputs and outputs,
   making the scoring reproducible from the payload alone (ENRICHER_SNAPSHOT_RULE)

The evaluator sees **all receipts in the epoch together**, not each one in isolation.
This enables relative scoring: "PR #42 restructured the auth module (high impact);
PR #43 fixed a typo in a comment (low impact)" — the scores reflect relative value
within the epoch's activity set.

#### Evaluation contract (fits existing `epoch_evaluations` table)

```
evaluation_ref:  "cogni.ai_scores.v0"
algo_ref:        "llm-contextual-v0"
status:          "draft" | "locked"
inputs_hash:     sha256(sorted receipt IDs + context snapshot hash)
payload_hash:    sha256(canonical payload)
payload_json:    {
  modelId:          "claude-sonnet-4-6",
  promptVersion:    "scoring-v0.3",
  repoCommitSha:    "abc123def",
  scoredAt:         "2026-02-28T...",
  perReceiptScores: {
    "github:pr:org/repo:42": {
      score:      8500,              // milli-units, integer
      reasoning:  "Restructured auth module...",
      context:    { filesChanged: [...], modulesTouched: [...] }
    },
    "github:pr:org/repo:43": {
      score:      200,
      reasoning:  "Typo fix in comment...",
      context:    { filesChanged: [...] }
    }
  }
}
```

**Key design decisions:**

- **Scores are integers (milli-units).** ALL_MATH_BIGINT holds. No floats.
- **Model and prompt version are recorded in the payload.** Anyone can see exactly
  what produced the score. But we do NOT re-run when models update — the locked
  evaluation is a permanent fact.
- **Repo commit SHA is pinned.** The evaluator scored against a specific codebase
  snapshot. This makes the context reproducible.
- **Reasoning is included.** The LLM explains its score. This is essential for
  auditability — humans reviewing the epoch can read the reasoning and override
  via the selection layer (`weight_override_milli`) if they disagree.

#### Generalizes beyond GitHub

The same pattern works for any source:

| Source  | Receipt captures           | Evaluator fetches                          |
| ------- | -------------------------- | ------------------------------------------ |
| GitHub  | PR merged, URL             | Full diff, codebase context, review thread |
| Discord | Message sent, channel, URL | Message content, thread context            |
| Issues  | Issue closed, URL          | Issue body, linked PRs, discussion         |

The receipt is always thin. The evaluator always fetches rich context. The scoring
always happens in context of the full epoch's activity set.

### Layer 3: Evaluation-Aware Allocation (new algo — fits existing dispatch)

Current V0 (`weight-sum-v0`) uses flat per-event-type weights and ignores evaluations
entirely. The new allocation algorithm consumes evaluation scores:

```typescript
// New case in computeProposedAllocations dispatch
case "eval-scored-v0":
  return evalScoredV0(events, evaluations);
```

The algorithm reads the locked `cogni.ai_scores.v0` evaluation for the epoch, looks up
each receipt's score from `perReceiptScores`, and uses that as the weight instead of
a flat config value. Admin overrides (`weight_override_milli`) still take precedence
(ALLOCATION_PRESERVES_OVERRIDES).

**Input broadening:** `computeProposedAllocations` currently takes
`(algoRef, events, weightConfig)`. For `eval-scored-v0`, it also needs the evaluation
payload. Options:

- **(a)** Add optional `evaluations` parameter to the existing function
- **(b)** Use a context object: `{ events, weightConfig, evaluations? }`

Option (b) is cleaner — it avoids growing the parameter list as future algorithms
need different inputs:

```typescript
interface AllocationContext {
  events: readonly SelectedReceiptForAllocation[];
  weightConfig: Record<string, number>;
  evaluations?: readonly AttributionEvaluation[];
}

function computeProposedAllocations(
  algoRef: string,
  ctx: AllocationContext
): ProposedAllocation[]
```

This is a minor refactor to the existing function signature. The `weight-sum-v0` path
ignores `evaluations` and behaves identically.

---

## Rebalancing: Forward Corrections, Never Rewrites

### The problem

Algorithm v0 scored all PRs at a flat 1000 milli-units. Algorithm v1 (LLM-powered)
can distinguish a 200-unit typo fix from an 8500-unit architecture refactor. The epochs
scored by v0 are permanently undervaluing some contributors and overvaluing others.

### The principle

**Finalized epochs are sealed journal entries.** You don't reopen them. You don't
unsign them. You don't re-score their receipts. The v0 statement for epoch 12 is a
permanent fact: "in February 2026, using weight-sum-v0, we valued Alice at 3000
and Bob at 2000."

Corrections go forward. A new entry in the journal says: "having re-analyzed epochs
1-15 with v1, we believe Alice was underpaid by 500 and Bob was overpaid by 300.
Here is a correction allocation."

This is standard journal accounting: you never erase entries, you post adjustments.

### The mechanism: rebalance epochs

A rebalance epoch is an epoch whose inputs are historical evaluations rather than
fresh activity. It goes through the same lifecycle (open → review → finalized) and
produces the same outputs (signed statement). The only difference is what drives it.

```
Activity Epoch (existing):
  receipts from source adapters → evaluation → allocation → statement

Rebalance Epoch (new):
  historical epoch data → re-evaluation with new algo → delta allocation → statement
```

#### Schema change: one column

```sql
ALTER TABLE epochs ADD COLUMN epoch_kind TEXT NOT NULL DEFAULT 'activity';
ALTER TABLE epochs ADD CONSTRAINT epochs_kind_check
  CHECK (epoch_kind IN ('activity', 'rebalance'));
```

That's it. Everything else — evaluations, allocations, pool components, statements,
signatures — works as-is.

#### Rebalance epoch lifecycle

1. **Create** — governance action (not scheduled collection). Admin creates a rebalance
   epoch referencing a scope and time period. `epoch_kind = 'rebalance'`.

2. **Evaluate** — the rebalance evaluator reads historical data:
   - Loads finalized statements for historical epochs in the target range
   - Loads the original receipts and their metadata
   - Runs the new algorithm (v1) against the historical events
   - Computes what the fair allocation "should have been"
   - Computes the delta: `v1_allocation - v0_allocation` per user
   - Produces an evaluation payload with full reasoning

   ```
   evaluation_ref:  "cogni.rebalance_review.v0"
   algo_ref:        "rebalance-delta-v0"
   payload_json:    {
     targetEpochRange:  [12, 15],
     originalAlgoRef:   "weight-sum-v0",
     newAlgoRef:        "eval-scored-v0",
     perUserDeltas: {
       "alice":  { original: 3000, revised: 3500, delta: 500 },
       "bob":    { original: 2000, revised: 1700, delta: -300 }
     },
     reasoning: "..."
   }
   ```

3. **Allocate** — the rebalance allocation algorithm reads the evaluation's
   `perUserDeltas` and produces proposed allocations. **V0: positive deltas only.**
   Users who were overpaid get 0 in the rebalance epoch — they keep what they received,
   but underpaid users catch up. Clawbacks are a governance decision deferred to V1+.

4. **Pool** — a `retroactive_adjustment` pool component funds the corrections.
   This is real money — governance must fund it explicitly. The pool total equals
   the sum of positive deltas.

5. **Review + Finalize** — admin reviews the rebalance proposal, signs, finalizes.
   Same signing flow, same immutability guarantees.

#### What the ledger looks like over time

```
Epoch 12 (activity, weight-sum-v0):
  Alice = 3000, Bob = 2000
  Signed by 0xABC, finalized 2026-02-10            ← permanent

Epoch 13 (activity, weight-sum-v0):
  Alice = 2500, Bob = 3500
  Signed by 0xABC, finalized 2026-02-17            ← permanent

Epoch 14 (activity, eval-scored-v0):
  Alice = 8500, Bob = 1200                          ← new algo, richer scoring
  Signed by 0xABC, finalized 2026-02-24            ← permanent

Epoch 15 (rebalance, rebalance-delta-v0):
  Reviewing epochs 12-13 with eval-scored-v0
  Alice = +1200 (underpaid), Bob = 0 (overpaid)    ← correction entry
  Pool: 1200 (retroactive_adjustment)
  Signed by 0xABC, finalized 2026-03-01            ← permanent
```

Anyone reading the ledger can see:
- What algorithm scored each epoch
- When the DAO switched algorithms
- What corrections were issued and why
- The full reasoning chain for every score

### Design decisions

#### Why positive-only rebalancing in V0?

`computeStatementItems` rejects negative `valuationUnits` (line 46 of `rules.ts`).
This is correct for V0 — negative allocations imply clawbacks, which require:
- Settlement layer integration (can you take back tokens already distributed?)
- Governance authorization (who approves clawbacks?)
- Legal/regulatory consideration

None of these exist yet. Positive-only rebalancing is safe: underpaid users catch up,
overpaid users simply don't receive corrections. Over successive rebalancing epochs,
the cumulative distribution converges toward fairness.

#### Why not re-evaluate old epochs?

Three reasons:
1. **Signed statements are commitments.** Re-evaluating would invalidate signatures.
   The signer attested to specific allocation data — changing that data is forgery.
2. **Determinism requires pinned inputs.** An evaluation is reproducible because it
   pins model ID, prompt version, repo commit SHA, and receipt set. "Re-running with
   a better model" produces a different evaluation — that's a new fact, not a correction
   to the old one.
3. **The journal model is more honest.** It acknowledges: "we scored this way then,
   we'd score differently now, and here's the correction." That's more transparent than
   silently replacing old scores.

#### Why one column instead of a new table?

A rebalance epoch IS an epoch. It has evaluations, allocations, pool components,
a statement, and signatures. Creating a parallel table structure would duplicate all
of those relationships. `epoch_kind` is a discriminator — it tells you how to interpret
the epoch, not what structure it has.

The `EPOCH_WINDOW_UNIQUE` constraint still holds — a rebalance epoch has its own
time window (when the rebalancing was computed), which won't collide with activity
epochs for different periods.

#### How does this interact with `supersedesStatementId`?

It doesn't need to. `supersedesStatementId` on `epoch_statements` is designed for
the case where a single epoch's statement is amended (e.g., fixing a computation error
before settlement). Rebalancing is a different concept — it's a new epoch with its own
statement, not an amendment to an old epoch's statement. Both mechanisms can coexist.

---

## Schema Impact Summary

| Change | Type | Detail |
| ------ | ---- | ------ |
| `epochs.epoch_kind` | Add column | `TEXT NOT NULL DEFAULT 'activity'`, CHECK IN ('activity', 'rebalance') |
| `computeProposedAllocations` signature | Refactor | `(algoRef, events, weightConfig)` → `(algoRef, ctx: AllocationContext)` |
| `pool_component_allowlist` | Extend | Add `'retroactive_adjustment'` |
| New enricher: `cogni.ai_scores.v0` | Additive | New `evaluation_ref`, existing table |
| New enricher: `cogni.rebalance_review.v0` | Additive | New `evaluation_ref`, existing table |
| New algo: `eval-scored-v0` | Additive | New case in allocation dispatch |
| New algo: `rebalance-delta-v0` | Additive | New case in allocation dispatch |
| New workflow: `RebalanceEpochWorkflow` | Additive | Temporal workflow, similar lifecycle to CollectEpoch |

No new tables. No removed columns. No changed invariants. The core pipeline
(ingestion → selection → evaluation → allocation → finalization) is unchanged.

---

## Open Questions

- [ ] Should the rebalance evaluation reference specific historical epoch IDs, or a
      time range? Epoch IDs are more precise; time ranges are simpler for governance.
- [ ] What triggers a rebalance — manual governance action only, or can it be
      scheduled (e.g., quarterly review)?
- [ ] For LLM evaluation: should the evaluator score all receipts in a single LLM call,
      or chunk them? Single call enables relative scoring; chunking handles scale.
- [ ] How do we handle evaluation cost? LLM calls per receipt add up. Should there be
      a cost budget per epoch, or is this an operator concern?
- [ ] Should rebalance epochs be constrained to reviewing epochs scored by older
      algorithms only, or can they also review same-version epochs (human-triggered
      re-review)?

## Related

- [attribution-ledger.md](../spec/attribution-ledger.md) — Core ledger spec (five-stage pipeline)
- [epoch-event-ingestion-pipeline.md](./epoch-event-ingestion-pipeline.md) — Ingestion adapter research
- [sourcecred.md](../spec/sourcecred.md) — Legacy SourceCred scoring (being superseded)
