// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/dev-lifecycle/graph`
 * Purpose: Development lifecycle graph — 17 nodes modeling the full command-driven workflow.
 * Scope: Creates StateGraph with react agent nodes and 3 review loops. Does NOT execute or read env.
 * Invariants:
 *   - PURE_FACTORY: No side effects, no env reads
 *   - SEVENTEEN_NODES: intake → idea → triage → research → project → spec_write → spec_review
 *     → spec_revise → task_decompose → task_prioritize → implement → test_verify
 *     → review_design → design_revise → review_impl → closeout → report
 *   - THREE_LOOPS: spec_review↔spec_revise, review_design↔design_revise, review_impl→implement
 *   - REACT_AGENTS_MAJORITY: 15/17 nodes use createReactAgent (88%)
 *   - TYPE_TRANSPARENT_RETURN: No explicit return type for CLI schema extraction
 * Side-effects: none
 * Links: development-lifecycle.md
 * @public
 */

import {
  AIMessage,
  type BaseMessage,
  type BaseMessageLike,
  coerceMessageLikeToMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

import type { CreateReactAgentGraphOptions } from "../types";
import {
  CLOSEOUT_PROMPT,
  DESIGN_REVISE_PROMPT,
  IDEA_PROMPT,
  IMPLEMENT_PROMPT,
  INTAKE_PROMPT,
  MAX_DESIGN_REVISIONS,
  MAX_IMPL_REVISIONS,
  MAX_SPEC_REVISIONS,
  PROJECT_PROMPT,
  REPORT_PROMPT,
  RESEARCH_PROMPT,
  REVIEW_DESIGN_PROMPT,
  REVIEW_IMPL_PROMPT,
  SPEC_REVIEW_PROMPT,
  SPEC_REVISE_PROMPT,
  SPEC_WRITE_PROMPT,
  TASK_DECOMPOSE_PROMPT,
  TASK_PRIORITIZE_PROMPT,
  TEST_VERIFY_PROMPT,
  TRIAGE_PROMPT,
} from "./prompts";
import { type DevLifecycleState, DevLifecycleStateAnnotation } from "./state";

export const DEV_LIFECYCLE_GRAPH_NAME = "dev-lifecycle" as const;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function coerceMessages(
  messages: readonly BaseMessageLike[] | undefined
): BaseMessage[] {
  return (messages ?? []).map((m) => coerceMessageLikeToMessage(m));
}

function getMessageType(msg: BaseMessage): string {
  return msg.getType?.() ?? (msg as unknown as { type?: string }).type ?? "";
}

function extractContent(msg: BaseMessage | undefined): string {
  if (!msg) return "";
  return typeof msg.content === "string" ? msg.content : "";
}

/**
 * Invoke a react agent with a context string and return the final response text.
 */
async function invokeReactAgent(
  // biome-ignore lint/suspicious/noExplicitAny: React agent compiled graph type varies
  agent: any,
  context: string,
  config: RunnableConfig
): Promise<string> {
  const result = await agent.invoke(
    { messages: [new HumanMessage(context)] },
    config
  );
  const msgs: BaseMessage[] = result.messages ?? [];
  const lastMsg = msgs[msgs.length - 1];
  return extractContent(lastMsg);
}

/**
 * Check if review output signals approval (keyword-based for scaffolding).
 */
function isApproved(reviewOutput: string): boolean {
  const upper = reviewOutput.toUpperCase();
  // "APPROVED" present but not "NEEDS_REVISION" or "NOT APPROVED"
  return upper.includes("APPROVED") && !upper.includes("NEEDS_REVISION");
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the development lifecycle graph.
 *
 * Architecture (17 nodes, 3 loops):
 * ```
 * START → intake → idea → triage → research → project → spec_write → spec_review
 *                                                           ↑              ↓
 *                                                      spec_revise ←── (needs work)
 *                                                                         ↓ (approved)
 *   task_decompose → task_prioritize → implement → test_verify → review_design
 *        ↑                                 ↑                         ↓
 *        │                                 │                    design_revise ←── (needs work)
 *        │                                 │                         ↓ (approved)
 *        │                                 └──── (needs work) ── review_impl
 *        │                                                           ↓ (approved)
 *        │                                                       closeout → report → END
 * ```
 *
 * @param opts - Options with LLM and tools
 * @returns Compiled LangGraph ready for invoke()
 */
export function createDevLifecycleGraph(opts: CreateReactAgentGraphOptions) {
  const { llm, tools } = opts;
  const toolArray: StructuredToolInterface[] = [...tools];

  // ── Create react agents (one per stage) ──
  // 15 react agents = 88% of nodes

  const ideaAgent = createReactAgent({
    llm,
    tools: toolArray,
    messageModifier: IDEA_PROMPT,
    stateSchema: MessagesAnnotation,
  });

  const triageAgent = createReactAgent({
    llm,
    tools: toolArray,
    messageModifier: TRIAGE_PROMPT,
    stateSchema: MessagesAnnotation,
  });

  const researchAgent = createReactAgent({
    llm,
    tools: toolArray,
    messageModifier: RESEARCH_PROMPT,
    stateSchema: MessagesAnnotation,
  });

  const projectAgent = createReactAgent({
    llm,
    tools: toolArray,
    messageModifier: PROJECT_PROMPT,
    stateSchema: MessagesAnnotation,
  });

  const specWriteAgent = createReactAgent({
    llm,
    tools: toolArray,
    messageModifier: SPEC_WRITE_PROMPT,
    stateSchema: MessagesAnnotation,
  });

  const specReviewAgent = createReactAgent({
    llm,
    tools: toolArray,
    messageModifier: SPEC_REVIEW_PROMPT,
    stateSchema: MessagesAnnotation,
  });

  const specReviseAgent = createReactAgent({
    llm,
    tools: toolArray,
    messageModifier: SPEC_REVISE_PROMPT,
    stateSchema: MessagesAnnotation,
  });

  const taskDecomposeAgent = createReactAgent({
    llm,
    tools: toolArray,
    messageModifier: TASK_DECOMPOSE_PROMPT,
    stateSchema: MessagesAnnotation,
  });

  const taskPrioritizeAgent = createReactAgent({
    llm,
    tools: toolArray,
    messageModifier: TASK_PRIORITIZE_PROMPT,
    stateSchema: MessagesAnnotation,
  });

  const implementAgent = createReactAgent({
    llm,
    tools: toolArray,
    messageModifier: IMPLEMENT_PROMPT,
    stateSchema: MessagesAnnotation,
  });

  const testVerifyAgent = createReactAgent({
    llm,
    tools: toolArray,
    messageModifier: TEST_VERIFY_PROMPT,
    stateSchema: MessagesAnnotation,
  });

  const reviewDesignAgent = createReactAgent({
    llm,
    tools: toolArray,
    messageModifier: REVIEW_DESIGN_PROMPT,
    stateSchema: MessagesAnnotation,
  });

  const designReviseAgent = createReactAgent({
    llm,
    tools: toolArray,
    messageModifier: DESIGN_REVISE_PROMPT,
    stateSchema: MessagesAnnotation,
  });

  const reviewImplAgent = createReactAgent({
    llm,
    tools: toolArray,
    messageModifier: REVIEW_IMPL_PROMPT,
    stateSchema: MessagesAnnotation,
  });

  const closeoutAgent = createReactAgent({
    llm,
    tools: toolArray,
    messageModifier: CLOSEOUT_PROMPT,
    stateSchema: MessagesAnnotation,
  });

  // ── Node functions ──

  // 1. intake (plain LLM — classifies the request)
  async function intake(state: DevLifecycleState, config: RunnableConfig) {
    const messages = coerceMessages(state.messages);
    const userMessages = messages.filter((m) => getMessageType(m) === "human");
    const lastUserMessage = userMessages[userMessages.length - 1];
    const userRequest = extractContent(lastUserMessage);

    // biome-ignore lint/suspicious/noExplicitAny: LangGraph LLM invoke requires dynamic typing
    const response = (await (llm as any).invoke(
      [new SystemMessage(INTAKE_PROMPT), new HumanMessage(userRequest)],
      config
    )) as AIMessage;

    return {
      userRequest,
      intakeAnalysis: extractContent(response),
    };
  }

  // 2. idea (react agent — captures story work item)
  async function idea(state: DevLifecycleState, config: RunnableConfig) {
    const context = [
      "## User Request",
      state.userRequest,
      "",
      "## Intake Analysis",
      state.intakeAnalysis,
    ].join("\n");

    const output = await invokeReactAgent(ideaAgent, context, config);
    return { ideaDoc: output };
  }

  // 3. triage (react agent — routes the work item)
  async function triage(state: DevLifecycleState, config: RunnableConfig) {
    const context = [
      "## Idea Document",
      state.ideaDoc,
      "",
      "## Intake Analysis",
      state.intakeAnalysis,
    ].join("\n");

    const output = await invokeReactAgent(triageAgent, context, config);
    return { triageResult: output };
  }

  // 4. research (react agent — spike research)
  async function research(state: DevLifecycleState, config: RunnableConfig) {
    const context = [
      "## Triage Decision",
      state.triageResult,
      "",
      "## Idea Document",
      state.ideaDoc,
    ].join("\n");

    const output = await invokeReactAgent(researchAgent, context, config);
    return { researchNotes: output };
  }

  // 5. project (react agent — creates project plan)
  async function project(state: DevLifecycleState, config: RunnableConfig) {
    const context = [
      "## Research Notes",
      state.researchNotes,
      "",
      "## Triage Decision",
      state.triageResult,
      "",
      "## Idea Document",
      state.ideaDoc,
    ].join("\n");

    const output = await invokeReactAgent(projectAgent, context, config);
    return { projectPlan: output };
  }

  // 6. spec_write (react agent — drafts technical spec)
  async function specWrite(state: DevLifecycleState, config: RunnableConfig) {
    const context = [
      "## Project Plan",
      state.projectPlan,
      "",
      "## Research Notes",
      state.researchNotes,
      "",
      ...(state.specRevisionCount > 0
        ? [
            "## Previous Spec Draft",
            state.specDraft,
            "",
            "## Revision Feedback",
            state.specRevision,
          ]
        : []),
    ].join("\n");

    const output = await invokeReactAgent(specWriteAgent, context, config);
    return { specDraft: output };
  }

  // 7. spec_review (react agent — reviews spec quality)
  async function specReview(state: DevLifecycleState, config: RunnableConfig) {
    const context = [
      "## Spec Draft to Review",
      state.specDraft,
      "",
      "## Project Plan",
      state.projectPlan,
      "",
      `Revision round: ${state.specRevisionCount} / ${MAX_SPEC_REVISIONS}`,
    ].join("\n");

    const output = await invokeReactAgent(specReviewAgent, context, config);
    const approved = isApproved(output);

    return {
      specReviewFeedback: output,
      specApproved: approved,
    };
  }

  // 8. spec_revise (react agent — revises spec based on feedback)
  async function specRevise(state: DevLifecycleState, config: RunnableConfig) {
    const context = [
      "## Current Spec Draft",
      state.specDraft,
      "",
      "## Review Feedback",
      state.specReviewFeedback,
    ].join("\n");

    const output = await invokeReactAgent(specReviseAgent, context, config);
    return {
      specRevision: output,
      specDraft: output,
      specRevisionCount: (state.specRevisionCount ?? 0) + 1,
    };
  }

  // 9. task_decompose (react agent — breaks spec into tasks)
  async function taskDecompose(
    state: DevLifecycleState,
    config: RunnableConfig
  ) {
    const context = [
      "## Approved Spec",
      state.specDraft,
      "",
      "## Project Plan",
      state.projectPlan,
    ].join("\n");

    const output = await invokeReactAgent(taskDecomposeAgent, context, config);
    return { taskBreakdown: output };
  }

  // 10. task_prioritize (react agent — orders tasks)
  async function taskPrioritize(
    state: DevLifecycleState,
    config: RunnableConfig
  ) {
    const context = [
      "## Task Breakdown",
      state.taskBreakdown,
      "",
      "## Project Plan",
      state.projectPlan,
    ].join("\n");

    const output = await invokeReactAgent(taskPrioritizeAgent, context, config);
    return { taskPriority: output };
  }

  // 11. implement (react agent — executes the implementation)
  async function implement(state: DevLifecycleState, config: RunnableConfig) {
    const feedbackSection =
      state.designRevisionCount > 0 || state.implRevisionCount > 0
        ? [
            "",
            "## Review Feedback to Address",
            state.designReviewFeedback || state.implReviewFeedback,
            "",
            "## Previous Implementation",
            state.implementationResult,
          ]
        : [];

    const context = [
      "## Prioritized Tasks",
      state.taskPriority,
      "",
      "## Spec",
      state.specDraft,
      ...feedbackSection,
    ].join("\n");

    const output = await invokeReactAgent(implementAgent, context, config);
    return { implementationResult: output };
  }

  // 12. test_verify (react agent — verifies implementation)
  async function testVerify(state: DevLifecycleState, config: RunnableConfig) {
    const context = [
      "## Implementation",
      state.implementationResult,
      "",
      "## Spec Invariants",
      state.specDraft,
      "",
      "## Task Requirements",
      state.taskPriority,
    ].join("\n");

    const output = await invokeReactAgent(testVerifyAgent, context, config);
    return { testResults: output };
  }

  // 13. review_design (react agent — architecture review)
  async function reviewDesign(
    state: DevLifecycleState,
    config: RunnableConfig
  ) {
    const context = [
      "## Implementation to Review",
      state.implementationResult,
      "",
      "## Test Results",
      state.testResults,
      "",
      "## Spec",
      state.specDraft,
      "",
      `Design revision round: ${state.designRevisionCount} / ${MAX_DESIGN_REVISIONS}`,
    ].join("\n");

    const output = await invokeReactAgent(reviewDesignAgent, context, config);
    const approved = isApproved(output);

    return {
      designReviewFeedback: output,
      designApproved: approved,
    };
  }

  // 14. design_revise (react agent — addresses design feedback)
  async function designRevise(
    state: DevLifecycleState,
    config: RunnableConfig
  ) {
    const context = [
      "## Current Implementation",
      state.implementationResult,
      "",
      "## Design Review Feedback",
      state.designReviewFeedback,
    ].join("\n");

    const output = await invokeReactAgent(designReviseAgent, context, config);
    return {
      designRevision: output,
      implementationResult: output,
      designRevisionCount: (state.designRevisionCount ?? 0) + 1,
    };
  }

  // 15. review_impl (react agent — code review)
  async function reviewImpl(state: DevLifecycleState, config: RunnableConfig) {
    const context = [
      "## Implementation to Review",
      state.implementationResult,
      "",
      "## Test Results",
      state.testResults,
      "",
      "## Design Review (passed)",
      state.designReviewFeedback,
      "",
      `Implementation revision round: ${state.implRevisionCount} / ${MAX_IMPL_REVISIONS}`,
    ].join("\n");

    const output = await invokeReactAgent(reviewImplAgent, context, config);
    const approved = isApproved(output);

    return {
      implReviewFeedback: output,
      implApproved: approved,
      implRevisionCount: approved
        ? state.implRevisionCount
        : (state.implRevisionCount ?? 0) + 1,
    };
  }

  // 16. closeout (react agent — pre-PR finish pass)
  async function closeout(state: DevLifecycleState, config: RunnableConfig) {
    const context = [
      "## Implementation (approved)",
      state.implementationResult,
      "",
      "## Spec",
      state.specDraft,
      "",
      "## Idea Document",
      state.ideaDoc,
      "",
      "## Task Breakdown",
      state.taskBreakdown,
    ].join("\n");

    const output = await invokeReactAgent(closeoutAgent, context, config);
    return { closeoutResult: output };
  }

  // 17. report (plain LLM — final summary)
  async function report(state: DevLifecycleState, config: RunnableConfig) {
    const context = [
      "## Original Request",
      state.userRequest,
      "",
      "## Intake Analysis",
      state.intakeAnalysis,
      "",
      "## Idea",
      state.ideaDoc,
      "",
      "## Triage",
      state.triageResult,
      "",
      "## Research",
      state.researchNotes,
      "",
      "## Project Plan",
      state.projectPlan,
      "",
      "## Spec (final)",
      state.specDraft,
      "",
      "## Tasks",
      state.taskBreakdown,
      "",
      "## Implementation",
      state.implementationResult,
      "",
      "## Test Results",
      state.testResults,
      "",
      "## Closeout",
      state.closeoutResult,
    ].join("\n");

    // biome-ignore lint/suspicious/noExplicitAny: LangGraph LLM invoke requires dynamic typing
    const response = (await (llm as any).invoke(
      [new SystemMessage(REPORT_PROMPT), new HumanMessage(context)],
      config
    )) as AIMessage;

    const finalReport = extractContent(response);

    return {
      finalReport,
      messages: [new AIMessage(finalReport)],
    };
  }

  // ── Router functions (for loops) ──

  function routeSpecReview(state: DevLifecycleState): string {
    if (
      state.specApproved ||
      (state.specRevisionCount ?? 0) >= MAX_SPEC_REVISIONS
    ) {
      return "task_decompose";
    }
    return "spec_revise";
  }

  function routeDesignReview(state: DevLifecycleState): string {
    if (
      state.designApproved ||
      (state.designRevisionCount ?? 0) >= MAX_DESIGN_REVISIONS
    ) {
      return "review_impl";
    }
    return "design_revise";
  }

  function routeImplReview(state: DevLifecycleState): string {
    if (
      state.implApproved ||
      (state.implRevisionCount ?? 0) >= MAX_IMPL_REVISIONS
    ) {
      return "closeout";
    }
    return "implement";
  }

  // ── Build the graph ──

  const builder = new StateGraph(DevLifecycleStateAnnotation)
    // Register all 17 nodes
    .addNode("intake", intake)
    .addNode("idea", idea)
    .addNode("triage", triage)
    .addNode("research", research)
    .addNode("project", project)
    .addNode("spec_write", specWrite)
    .addNode("spec_review", specReview)
    .addNode("spec_revise", specRevise)
    .addNode("task_decompose", taskDecompose)
    .addNode("task_prioritize", taskPrioritize)
    .addNode("implement", implement)
    .addNode("test_verify", testVerify)
    .addNode("review_design", reviewDesign)
    .addNode("design_revise", designRevise)
    .addNode("review_impl", reviewImpl)
    .addNode("closeout", closeout)
    .addNode("report", report)

    // ── Linear spine ──
    .addEdge("__start__", "intake")
    .addEdge("intake", "idea")
    .addEdge("idea", "triage")
    .addEdge("triage", "research")
    .addEdge("research", "project")
    .addEdge("project", "spec_write")
    .addEdge("spec_write", "spec_review")

    // ── LOOP 1: spec review ↔ spec revise ──
    .addConditionalEdges("spec_review", routeSpecReview)
    .addEdge("spec_revise", "spec_review")

    // ── Linear: tasks → implementation ──
    .addEdge("task_decompose", "task_prioritize")
    .addEdge("task_prioritize", "implement")
    .addEdge("implement", "test_verify")
    .addEdge("test_verify", "review_design")

    // ── LOOP 2: design review ↔ design revise ──
    .addConditionalEdges("review_design", routeDesignReview)
    .addEdge("design_revise", "review_design")

    // ── LOOP 3: impl review → implement ──
    .addConditionalEdges("review_impl", routeImplReview)

    // ── Finish ──
    .addEdge("closeout", "report")
    .addEdge("report", "__end__");

  return builder.compile();
}
