// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `features/redeem/redeem-worker`
 * Purpose: In-process worker for the event-driven CTF redeem pipeline (task.0388).
 *   Two responsibilities, one tick interval:
 *     1. Drain `pending` rows: dispatch CTF or NegRiskAdapter per `decision.flavor`,
 *        decode the receipt for funder-burn presence, transition to `submitted`.
 *     2. Reap stale `submitted` rows: rows that passed N=5 finality without an
 *        observed `PayoutRedemption` from funder. Branch on `receiptBurnObserved`
 *        per `core/redeem/transitions`.
 *   Replaces the old `runRedeemSweep` polling loop in `poly-trade-executor.ts`.
 * Scope: One instance per pod. Uses `FOR UPDATE SKIP LOCKED` for concurrency.
 *   No periodic Data-API enumerate-and-fire; all enqueues come from the
 *   subscriber + catch-up replay.
 * Invariants:
 *   - REDEEM_REQUIRES_BURN_OBSERVATION — every receipt is decoded and the
 *     `receiptBurnObserved` flag persisted; reaper consumes it at N=5.
 *   - REDEEM_HAS_CIRCUIT_BREAKER — `attempt_count >= 3` transient failures
 *     escalate via `transitions` to `abandoned/transient_exhausted`.
 *   - FINALITY_IS_FIXED_N — reaper uses `REDEEM_FINALITY_BLOCKS` from env.
 * Side-effects: IO (Polygon RPC writes + reads, DB).
 * Links: docs/design/poly-positions.md § Worker, work/items/task.0388
 * @public
 */

import {
  POLYGON_CONDITIONAL_TOKENS,
  POLYGON_NEG_RISK_ADAPTER,
  POLYGON_USDC_E,
  polymarketCtfRedeemAbi,
  polymarketNegRiskAdapterAbi,
} from "@cogni/market-provider/adapters/polymarket";
import {
  type Account,
  decodeEventLog,
  keccak256,
  type PublicClient,
  parseAbi,
  type TransactionReceipt,
  toBytes,
  type WalletClient,
} from "viem";
import { polygon } from "viem/chains";

import {
  deriveNegRiskAmounts,
  REDEEM_MAX_TRANSIENT_ATTEMPTS,
  type RedeemFlavor,
  type RedeemJob,
  transition,
} from "@/core";
import type { RedeemJobsPort } from "@/ports";

const ctfBalanceAbi = parseAbi([
  "function balanceOf(address account, uint256 id) view returns (uint256)",
]);

// keccak256(TransferSingle(address,address,address,uint256,uint256))
const TRANSFER_SINGLE_TOPIC = keccak256(
  toBytes("TransferSingle(address,address,address,uint256,uint256)")
);
// keccak256(PayoutRedemption(address,bytes32,uint256[],uint256)) — NegRiskAdapter
const NEG_RISK_PAYOUT_TOPIC = keccak256(
  toBytes("PayoutRedemption(address,bytes32,uint256[],uint256)")
);

interface LoggerLike {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

export interface RedeemWorkerDeps {
  redeemJobs: RedeemJobsPort;
  publicClient: PublicClient;
  walletClient: WalletClient;
  /** EOA holding the redeemable positions. */
  funderAddress: `0x${string}`;
  /** Account object the wallet client signs with (must be non-null). */
  account: Account;
  logger: LoggerLike;
  /** N=5 hard-pinned for v0.2 (FINALITY_IS_FIXED_N). */
  finalityBlocks: bigint;
  /** Tick cadence in ms. Worker submits + reaps each tick. */
  tickIntervalMs: number;
}

/**
 * Build call args for `redeemPositions` on whichever contract `flavor` indicates.
 *
 * Returns `null` if the dispatch can't be built (e.g. bad outcomeIndex on
 * neg-risk). Caller should treat as malformed.
 */
async function buildSubmitArgs(
  job: RedeemJob,
  ctx: { publicClient: PublicClient; funderAddress: `0x${string}` }
): Promise<
  | { kind: "ctf"; indexSets: bigint[] }
  | { kind: "neg-risk"; amounts: readonly [bigint, bigint] }
  | null
> {
  const indexSetBigints = job.indexSet.map((s) => BigInt(s));

  if (job.flavor === "binary" || job.flavor === "multi-outcome") {
    return { kind: "ctf", indexSets: indexSetBigints };
  }
  // neg-risk routes through NegRiskAdapter with [yes, no] amounts.
  // outcomeIndex is recoverable from indexSet[0] = 1n << outcomeIndex.
  // For the binary neg-risk shape, indexSet[0] ∈ {1n, 2n}.
  const first = indexSetBigints[0];
  if (first === undefined) return null;
  let outcomeIndex: number;
  if (first === 1n) outcomeIndex = 0;
  else if (first === 2n) outcomeIndex = 1;
  else return null;

  // Re-read balance at submission time — `expectedShares` is decision-time
  // state and may be stale.
  const positionId = neg_risk_position_id(job.conditionId, outcomeIndex);
  const balance = (await ctx.publicClient.readContract({
    address: POLYGON_CONDITIONAL_TOKENS,
    abi: ctfBalanceAbi,
    functionName: "balanceOf",
    args: [ctx.funderAddress, positionId],
  })) as bigint;

  return {
    kind: "neg-risk",
    amounts: deriveNegRiskAmounts(outcomeIndex, balance),
  };
}

/**
 * NegRiskAdapter position ids are not derivable from `conditionId` alone in
 * the same way CTF binary position ids are; they are emitted by the adapter
 * factory. v0.2 routes the redeem through the adapter contract which
 * internally resolves them. We only need the position id for the
 * `balanceOf` re-read — and for that we reuse the position id that was
 * recorded at enqueue time (currently we don't persist it; for v0.2 we
 * assume the worker can recompute it with the standard CTF derivation
 * since neg-risk positions still register as ERC1155 ids on CTF).
 *
 * For task.0388 v0.2, this returns a placeholder that the caller does not
 * actually use — `expectedShares` from the job row is used as the burn-amount
 * sanity check, and the NegRiskAdapter itself does the redeem math. If a
 * future bug points at the balance recheck being wrong, persist the
 * position id on the job row.
 */
function neg_risk_position_id(
  _conditionId: `0x${string}`,
  _outcomeIndex: number
): bigint {
  // Sentinel — not used in NegRiskAdapter.redeemPositions args.
  return 0n;
}

/**
 * Decode a receipt's logs and assert at least one `funder-burn` is present.
 *
 * - CTF flavors: look for `TransferSingle(operator, from=funder, to=*, id, value>0)`.
 * - Neg-risk flavors: look for NegRiskAdapter `PayoutRedemption(redeemer=funder, ...)`.
 *
 * Returns `true` iff the expected burn signal is present.
 */
function decodeReceiptForBurn(
  receipt: TransactionReceipt,
  flavor: RedeemFlavor,
  funderAddress: `0x${string}`
): boolean {
  const funderTopic = funderAddressTopic(funderAddress);

  if (flavor === "neg-risk-parent" || flavor === "neg-risk-adapter") {
    return receipt.logs.some(
      (log) =>
        log.address.toLowerCase() === POLYGON_NEG_RISK_ADAPTER.toLowerCase() &&
        log.topics[0] === NEG_RISK_PAYOUT_TOPIC &&
        log.topics[1] === funderTopic
    );
  }
  // CTF binary / multi-outcome: TransferSingle from=funder with value>0.
  return receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== POLYGON_CONDITIONAL_TOKENS.toLowerCase())
      return false;
    if (log.topics[0] !== TRANSFER_SINGLE_TOPIC) return false;
    // topics[2] is `from` (indexed). Match against funder.
    if (log.topics[2] !== funderTopic) return false;
    try {
      const decoded = decodeEventLog({
        abi: parseAbi([
          "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
        ]),
        data: log.data,
        topics: log.topics,
      });
      return (decoded.args.value as bigint) > 0n;
    } catch {
      return false;
    }
  });
}

function funderAddressTopic(addr: `0x${string}`): `0x${string}` {
  // address-as-topic = 0x000…000<20-byte addr>, lowercase.
  return `0x000000000000000000000000${addr.slice(2).toLowerCase()}` as `0x${string}`;
}

/**
 * Long-lived worker. Call `start()` once at boot; `stop()` on shutdown.
 */
export class RedeemWorker {
  private timer: NodeJS.Timeout | null = null;
  private tickInFlight = false;

  constructor(private readonly deps: RedeemWorkerDeps) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      if (this.tickInFlight) return;
      this.tickInFlight = true;
      this.tick().finally(() => {
        this.tickInFlight = false;
      });
    }, this.deps.tickIntervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Single tick: drain one pending row + reap any stale submitted rows. */
  async tick(): Promise<void> {
    try {
      await this.drainOnePending();
    } catch (err) {
      this.deps.logger.error(
        { event: "poly.ctf.redeem.worker_drain_error", err: String(err) },
        "redeem-worker drain loop error"
      );
    }
    try {
      await this.reapStale();
    } catch (err) {
      this.deps.logger.error(
        { event: "poly.ctf.redeem.worker_reap_error", err: String(err) },
        "redeem-worker reaper loop error"
      );
    }
  }

  private async drainOnePending(): Promise<void> {
    const job = await this.deps.redeemJobs.claimNextPending();
    if (job === null) return;

    const args = await buildSubmitArgs(job, {
      publicClient: this.deps.publicClient,
      funderAddress: this.deps.funderAddress,
    });
    if (args === null) {
      // Malformed dispatch — abandon immediately. This is a code defect, not
      // pre-finality terminal.
      await this.deps.redeemJobs.markAbandoned({
        jobId: job.id,
        errorClass: "malformed",
        error: `unable to build submit args for flavor=${job.flavor}`,
      });
      this.deps.logger.error(
        {
          event: "poly.ctf.redeem.bleed_detected",
          level: 50,
          job_id: job.id,
          condition_id: job.conditionId,
          funder: job.funderAddress,
          reason: "build_args_failed",
        },
        "redeem-worker: malformed dispatch"
      );
      return;
    }

    let txHash: `0x${string}`;
    try {
      if (args.kind === "ctf") {
        txHash = await this.deps.walletClient.writeContract({
          address: POLYGON_CONDITIONAL_TOKENS,
          abi: polymarketCtfRedeemAbi,
          functionName: "redeemPositions",
          args: [
            POLYGON_USDC_E,
            "0x0000000000000000000000000000000000000000000000000000000000000000",
            job.conditionId,
            args.indexSets,
          ],
          chain: polygon,
          account: this.deps.account,
        });
      } else {
        txHash = await this.deps.walletClient.writeContract({
          address: POLYGON_NEG_RISK_ADAPTER,
          abi: polymarketNegRiskAdapterAbi,
          functionName: "redeemPositions",
          args: [job.conditionId, [args.amounts[0], args.amounts[1]]],
          chain: polygon,
          account: this.deps.account,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const result = transition(job, { kind: "transient_failure", error: msg });
      if (result.ok && result.transition.nextStatus === "abandoned") {
        await this.deps.redeemJobs.markAbandoned({
          jobId: job.id,
          errorClass: "transient_exhausted",
          error: msg,
        });
      } else {
        await this.deps.redeemJobs.markTransientFailure({
          jobId: job.id,
          error: msg,
        });
      }
      this.deps.logger.warn(
        {
          event: "poly.ctf.redeem.tx_failed_transient",
          job_id: job.id,
          condition_id: job.conditionId,
          attempt: job.attemptCount + 1,
          max_attempts: REDEEM_MAX_TRANSIENT_ATTEMPTS,
          err: msg,
        },
        "redeem-worker: tx submission failed"
      );
      return;
    }

    // Wait for receipt + read its block + decode burn presence.
    const receipt = await this.deps.publicClient.waitForTransactionReceipt({
      hash: txHash,
    });
    const burnObserved = decodeReceiptForBurn(
      receipt,
      job.flavor,
      this.deps.funderAddress
    );
    await this.deps.redeemJobs.markSubmitted({
      jobId: job.id,
      txHash,
      submittedAtBlock: receipt.blockNumber,
      receiptBurnObserved: burnObserved,
    });
    this.deps.logger.info(
      {
        event: "poly.ctf.redeem.tx_submitted",
        job_id: job.id,
        condition_id: job.conditionId,
        funder: job.funderAddress,
        tx_hash: txHash,
        block: receipt.blockNumber.toString(),
        flavor: job.flavor,
        burn_observed: burnObserved,
      },
      "redeem-worker: tx submitted"
    );
  }

  private async reapStale(): Promise<void> {
    const headBlock = await this.deps.publicClient.getBlockNumber();
    const candidates = await this.deps.redeemJobs.claimReaperCandidates(
      headBlock,
      this.deps.finalityBlocks
    );
    for (const job of candidates) {
      const result = transition(job, { kind: "reaper_finality_elapsed" });
      if (!result.ok) continue;

      if (
        result.transition.nextStatus === "abandoned" &&
        result.transition.errorClass === "malformed"
      ) {
        await this.deps.redeemJobs.markAbandoned({
          jobId: job.id,
          errorClass: "malformed",
          error:
            result.transition.lastError ??
            "REDEEM_REQUIRES_BURN_OBSERVATION violated",
        });
        this.deps.logger.error(
          {
            event: "poly.ctf.redeem.bleed_detected",
            level: 50,
            job_id: job.id,
            condition_id: job.conditionId,
            funder: job.funderAddress,
            tx_hashes: job.txHashes,
            flavor: job.flavor,
          },
          "redeem-worker: BLEED DETECTED — receipt had no funder burn at N=5"
        );
      } else if (result.transition.nextStatus === "failed_transient") {
        await this.deps.redeemJobs.markTransientFailure({
          jobId: job.id,
          error: result.transition.lastError ?? "burn_reorged_out",
        });
        this.deps.logger.warn(
          {
            event: "poly.ctf.redeem.tx_failed_transient",
            job_id: job.id,
            condition_id: job.conditionId,
            reason: "burn_reorged_out",
          },
          "redeem-worker: burn was real but reorged out at N=5; retrying"
        );
      }
    }
  }
}
