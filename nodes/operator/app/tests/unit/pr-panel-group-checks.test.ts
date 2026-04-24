// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/pr-panel-group-checks.test`
 * Purpose: Unit tests for the PR panel's presentation logic — normalize()
 *          mapping from GitHub status/conclusion to UI status, prefix
 *          classification, rollup, and overallStatus fold (including the
 *          awaiting-credit rule).
 * Scope: Pure-function tests only; no React, no fetch.
 * Invariants: Every branch of overallStatus must be exercised.
 * Side-effects: none
 * Links: src/app/(app)/dashboard/_components/pr-panel/group-checks.ts
 * @internal
 */

import type { CheckInfo } from "@cogni/ai-tools";
import { describe, expect, it } from "vitest";

import {
  computeEntryStatus,
  groupChecks,
  overallStatus,
} from "@/app/(app)/dashboard/_components/pr-panel/group-checks";

function check(
  name: string,
  status: string,
  conclusion: string | null = null
): CheckInfo {
  return { name, status, conclusion };
}

describe("groupChecks — normalize", () => {
  it("in_progress → running", () => {
    const [ci] = groupChecks([check("Lint", "in_progress")]);
    expect(ci.checks[0].status).toBe("running");
  });

  it("queued / waiting / pending → pending", () => {
    const [ci] = groupChecks([
      check("a", "queued"),
      check("b", "waiting"),
      check("c", "pending"),
    ]);
    expect(ci.checks.map((c) => c.status)).toEqual([
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("completed with success/neutral/skipped → passing", () => {
    const [ci] = groupChecks([
      check("a", "completed", "success"),
      check("b", "completed", "neutral"),
      check("c", "completed", "skipped"),
    ]);
    expect(ci.checks.map((c) => c.status)).toEqual([
      "passing",
      "passing",
      "passing",
    ]);
  });

  it("completed with null conclusion → pending (not failed)", () => {
    const [ci] = groupChecks([check("a", "completed", null)]);
    expect(ci.checks[0].status).toBe("pending");
  });

  it("completed with failure/timed_out/cancelled/action_required/stale → failed", () => {
    const [ci] = groupChecks([
      check("a", "completed", "failure"),
      check("b", "completed", "timed_out"),
      check("c", "completed", "cancelled"),
      check("d", "completed", "action_required"),
      check("e", "completed", "stale"),
    ]);
    for (const c of ci.checks) expect(c.status).toBe("failed");
  });
});

describe("groupChecks — classification", () => {
  it("candidate-flight and flight- prefixes go in flight bucket", () => {
    const groups = groupChecks([
      check("Lint", "completed", "success"),
      check("candidate-flight / build-image", "completed", "success"),
      check("flight-verify", "completed", "success"),
    ]);
    expect(groups.map((g) => g.id)).toEqual(["ci", "flight"]);
    expect(groups[0].checks.map((c) => c.name)).toEqual(["Lint"]);
    expect(groups[1].checks.map((c) => c.name)).toEqual([
      "candidate-flight / build-image",
      "flight-verify",
    ]);
  });

  it("verify-buildsha and deploy- go in flight bucket", () => {
    const [, flight] = groupChecks([
      check("Build", "completed", "success"),
      check("verify-buildsha", "completed", "success"),
      check("deploy-prod", "completed", "success"),
    ]);
    expect(flight.checks.map((c) => c.name)).toEqual([
      "verify-buildsha",
      "deploy-prod",
    ]);
  });

  it("'argo' without delimiter does NOT match flight (argonaut-*)", () => {
    const groups = groupChecks([check("argonaut-precheck", "queued")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("ci");
  });

  it("'argo-sync' and 'argo/sync' DO match flight", () => {
    const groups = groupChecks([
      check("argo-sync", "in_progress"),
      check("argo/sync", "completed", "success"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[1].id).toBe("flight");
    expect(groups[1].checks).toHaveLength(2);
  });

  it("is case-insensitive", () => {
    const [, flight] = groupChecks([
      check("Build", "completed", "success"),
      check("Candidate-Flight / Build", "completed", "success"),
    ]);
    expect(flight).toBeDefined();
    expect(flight.checks[0].name).toBe("Candidate-Flight / Build");
  });

  it("omits flight group when no flight checks", () => {
    const groups = groupChecks([check("Lint", "completed", "success")]);
    expect(groups.map((g) => g.id)).toEqual(["ci"]);
  });
});

describe("groupChecks — rollup", () => {
  it("empty checks → pending", () => {
    const [ci] = groupChecks([]);
    expect(ci.status).toBe("pending");
    expect(ci.checks).toEqual([]);
  });

  it("any failed → failed (beats running/passing)", () => {
    const [ci] = groupChecks([
      check("a", "completed", "success"),
      check("b", "in_progress"),
      check("c", "completed", "failure"),
    ]);
    expect(ci.status).toBe("failed");
  });

  it("running beats passing + pending", () => {
    const [ci] = groupChecks([
      check("a", "completed", "success"),
      check("b", "in_progress"),
      check("c", "queued"),
    ]);
    expect(ci.status).toBe("running");
  });

  it("all passing → passing", () => {
    const [ci] = groupChecks([
      check("a", "completed", "success"),
      check("b", "completed", "neutral"),
    ]);
    expect(ci.status).toBe("passing");
  });

  it("mix of passing + pending → pending (not passing)", () => {
    const [ci] = groupChecks([
      check("a", "completed", "success"),
      check("b", "queued"),
    ]);
    expect(ci.status).toBe("pending");
  });
});

describe("overallStatus", () => {
  it("deployVerified short-circuits to passing", () => {
    expect(
      overallStatus({
        ci: "failed",
        flight: "failed",
        deployVerified: true,
      })
    ).toBe("failed"); // failure still dominates deployVerified? Check spec.
    // Per current rule: failure dominates first; deployVerified only short-circuits
    // when nothing failed.
    expect(
      overallStatus({
        ci: "passing",
        flight: "passing",
        deployVerified: true,
      })
    ).toBe("passing");
  });

  it("failure dominates", () => {
    expect(
      overallStatus({ ci: "failed", flight: undefined, deployVerified: false })
    ).toBe("failed");
    expect(
      overallStatus({ ci: "passing", flight: "failed", deployVerified: false })
    ).toBe("failed");
  });

  it("CI passing + no flight + not verified → passing", () => {
    expect(
      overallStatus({
        ci: "passing",
        flight: undefined,
        deployVerified: false,
      })
    ).toBe("passing");
  });

  it("awaiting-credit rule: CI passing + flight passing + not verified → running", () => {
    expect(
      overallStatus({
        ci: "passing",
        flight: "passing",
        deployVerified: false,
      })
    ).toBe("running");
  });

  it("anything running → running", () => {
    expect(
      overallStatus({
        ci: "running",
        flight: undefined,
        deployVerified: false,
      })
    ).toBe("running");
    expect(
      overallStatus({
        ci: "passing",
        flight: "running",
        deployVerified: false,
      })
    ).toBe("running");
  });

  it("all pending → pending", () => {
    expect(
      overallStatus({
        ci: "pending",
        flight: "pending",
        deployVerified: false,
      })
    ).toBe("pending");
  });
});

describe("computeEntryStatus — single-pass classifier", () => {
  it("returns both groups and overall status in one call", () => {
    const { groups, overall } = computeEntryStatus(
      [
        check("Lint", "completed", "success"),
        check("Build", "completed", "success"),
        check("candidate-flight / argo-sync", "in_progress"),
      ],
      false
    );
    expect(groups).toHaveLength(2);
    expect(overall).toBe("running");
  });

  it("deploy-verified flighted passing PR → overall passing", () => {
    const { overall } = computeEntryStatus(
      [
        check("Lint", "completed", "success"),
        check("candidate-flight", "completed", "success"),
      ],
      true
    );
    expect(overall).toBe("passing");
  });
});
