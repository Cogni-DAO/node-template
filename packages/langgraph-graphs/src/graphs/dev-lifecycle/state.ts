// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/dev-lifecycle/state`
 * Purpose: State schema for the development lifecycle graph (17 nodes, 3 loops).
 * Scope: Defines state annotation. Does NOT execute graph logic.
 * Invariants:
 *   - STATE_EXTENDS_MESSAGES: Includes MessagesAnnotation for conversation tracking
 *   - LAST_WRITE_WINS: Stage outputs use last-write-wins reducer
 *   - LOOP_BOUNDED: Revision counts enforce maximum loop iterations
 * Side-effects: none
 * Links: development-lifecycle.md
 * @public
 */

import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

// ─────────────────────────────────────────────────────────────────────────────
// Dev Lifecycle State
// ─────────────────────────────────────────────────────────────────────────────

/**
 * State for the development lifecycle graph.
 *
 * Models the full command-driven workflow from idea to closeout:
 * intake → idea → triage → research → project → spec_write → spec_review
 * → task_decompose → task_prioritize → implement → test_verify
 * → review_design → review_impl → closeout → report
 *
 * With 3 review loops:
 * 1. spec_review ↔ spec_revise (spec quality gate)
 * 2. review_design ↔ design_revise (architecture gate)
 * 3. review_impl → implement (implementation gate)
 */
export const DevLifecycleStateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,

  // ── User input ──
  /** Raw user request extracted from messages */
  userRequest: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
  }),

  // ── Stage outputs (last-write-wins) ──
  intakeAnalysis: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
  }),
  ideaDoc: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
  }),
  triageResult: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
  }),
  researchNotes: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
  }),
  projectPlan: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
  }),
  specDraft: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
  }),
  specReviewFeedback: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
  }),
  specRevision: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
  }),
  taskBreakdown: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
  }),
  taskPriority: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
  }),
  implementationResult: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
  }),
  testResults: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
  }),
  designReviewFeedback: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
  }),
  designRevision: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
  }),
  implReviewFeedback: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
  }),
  closeoutResult: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
  }),
  finalReport: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
  }),

  // ── Review gate flags ──
  specApproved: Annotation<boolean>({
    reducer: (_, right) => right ?? false,
    default: () => false,
  }),
  designApproved: Annotation<boolean>({
    reducer: (_, right) => right ?? false,
    default: () => false,
  }),
  implApproved: Annotation<boolean>({
    reducer: (_, right) => right ?? false,
    default: () => false,
  }),

  // ── Loop counters (bounded revisions) ──
  specRevisionCount: Annotation<number>({
    reducer: (_, right) => right ?? 0,
    default: () => 0,
  }),
  designRevisionCount: Annotation<number>({
    reducer: (_, right) => right ?? 0,
    default: () => 0,
  }),
  implRevisionCount: Annotation<number>({
    reducer: (_, right) => right ?? 0,
    default: () => 0,
  }),
});

export type DevLifecycleState = typeof DevLifecycleStateAnnotation.State;
