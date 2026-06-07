import { readFileSync } from "node:fs";
import { parse } from "yaml";

const CI_WORKFLOW_PATH = ".github/workflows/ci.yaml";
const PR_BUILD_WORKFLOW_PATH = ".github/workflows/pr-build.yml";
const PR_LINT_WORKFLOW_PATH = ".github/workflows/pr-lint.yaml";

const ciWorkflow = readWorkflow(CI_WORKFLOW_PATH);
const prBuildWorkflow = readWorkflow(PR_BUILD_WORKFLOW_PATH);
const prLintWorkflow = readWorkflow(PR_LINT_WORKFLOW_PATH);

function readWorkflow(path) {
  return parse(readFileSync(path, "utf8"));
}

function fail(path, message) {
  console.error(`${path}: ${message}`);
  process.exitCode = 1;
}

function expectEqual(path, actual, expected, label) {
  if (actual !== expected) {
    fail(path, `${label} must be ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`);
  }
}

function expectOwnKey(path, object, key, label) {
  if (!object || typeof object !== "object" || !Object.hasOwn(object, key)) {
    fail(path, `${label} must define ${key}`);
    return undefined;
  }
  return object[key];
}

function expectIncludes(path, value, fragment, label) {
  if (!String(value ?? "").includes(fragment)) {
    fail(path, `${label} must include ${JSON.stringify(fragment)}`);
  }
}

function expectStep(path, steps, name) {
  const step = steps.find((candidate) => candidate?.name === name);
  if (!step) fail(path, `steps must include ${JSON.stringify(name)}`);
  return step;
}

function expectTrigger(path, workflow, trigger) {
  const triggers = expectOwnKey(path, workflow, "on", "workflow");
  return expectOwnKey(path, triggers, trigger, "workflow triggers");
}

function expectMainPush(path, workflow) {
  const push = expectTrigger(path, workflow, "push");
  const branches = Array.isArray(push?.branches) ? push.branches : [];
  if (!branches.includes("main")) {
    fail(path, "push trigger must include main");
  }
}

function expectNoWorkflowDispatch(path, workflow) {
  const triggers = expectOwnKey(path, workflow, "on", "workflow");
  if (Object.hasOwn(triggers ?? {}, "workflow_dispatch")) {
    fail(path, "workflow must not use workflow_dispatch as launch or image evidence");
  }
}

expectEqual(CI_WORKFLOW_PATH, ciWorkflow?.name, "CI", "workflow name");
expectTrigger(CI_WORKFLOW_PATH, ciWorkflow, "pull_request");
expectTrigger(CI_WORKFLOW_PATH, ciWorkflow, "merge_group");
expectMainPush(CI_WORKFLOW_PATH, ciWorkflow);
expectNoWorkflowDispatch(CI_WORKFLOW_PATH, ciWorkflow);
expectEqual(CI_WORKFLOW_PATH, ciWorkflow?.permissions?.contents, "read", "permissions.contents");
expectIncludes(CI_WORKFLOW_PATH, ciWorkflow?.concurrency?.group, "ci-${{ github.workflow }}-${{ github.ref }}", "concurrency.group");
expectEqual(CI_WORKFLOW_PATH, ciWorkflow?.concurrency?.["cancel-in-progress"], true, "concurrency.cancel-in-progress");

const staticJob = ciWorkflow?.jobs?.static;
if (!staticJob) fail(CI_WORKFLOW_PATH, "jobs must include static");
const staticSteps = Array.isArray(staticJob?.steps) ? staticJob.steps : [];
expectStep(CI_WORKFLOW_PATH, staticSteps, "Install dependencies");
expectStep(CI_WORKFLOW_PATH, staticSteps, "Build workspace packages");
expectStep(CI_WORKFLOW_PATH, staticSteps, "Type check");
expectStep(CI_WORKFLOW_PATH, staticSteps, "Workflow contract check");

const unitJob = ciWorkflow?.jobs?.unit;
if (!unitJob) fail(CI_WORKFLOW_PATH, "jobs must include unit");
expectEqual(CI_WORKFLOW_PATH, unitJob?.needs, "static", "jobs.unit.needs");
const unitSteps = Array.isArray(unitJob?.steps) ? unitJob.steps : [];
expectStep(CI_WORKFLOW_PATH, unitSteps, "Install dependencies");
expectStep(CI_WORKFLOW_PATH, unitSteps, "Build workspace packages");
expectStep(CI_WORKFLOW_PATH, unitSteps, "Unit + contract coverage tests");

expectEqual(PR_BUILD_WORKFLOW_PATH, prBuildWorkflow?.name, "PR Build", "workflow name");
expectTrigger(PR_BUILD_WORKFLOW_PATH, prBuildWorkflow, "pull_request");
expectMainPush(PR_BUILD_WORKFLOW_PATH, prBuildWorkflow);
expectNoWorkflowDispatch(PR_BUILD_WORKFLOW_PATH, prBuildWorkflow);
expectEqual(PR_BUILD_WORKFLOW_PATH, prBuildWorkflow?.permissions?.contents, "read", "permissions.contents");
expectEqual(PR_BUILD_WORKFLOW_PATH, prBuildWorkflow?.permissions?.packages, "write", "permissions.packages");

const buildJob = prBuildWorkflow?.jobs?.build;
if (!buildJob) fail(PR_BUILD_WORKFLOW_PATH, "jobs must include build");
expectEqual(PR_BUILD_WORKFLOW_PATH, buildJob?.name, "Build and image", "jobs.build.name");
const buildSteps = Array.isArray(buildJob?.steps) ? buildJob.steps : [];
const sourceStep = expectStep(PR_BUILD_WORKFLOW_PATH, buildSteps, "Resolve source metadata");
const sourceRun = String(sourceStep?.run ?? "");
expectIncludes(PR_BUILD_WORKFLOW_PATH, sourceRun, "source_sha=\"$PR_HEAD_SHA\"", "pull_request source SHA");
expectIncludes(PR_BUILD_WORKFLOW_PATH, sourceRun, "source_sha=\"$PUSH_SHA\"", "push source SHA");
expectIncludes(PR_BUILD_WORKFLOW_PATH, sourceRun, "image_name=ghcr.io/${owner_lc}/${repo_lc}", "repo-owned image name");
expectIncludes(PR_BUILD_WORKFLOW_PATH, sourceRun, "image_tag=sha-${source_sha}", "source SHA image tag");
expectStep(PR_BUILD_WORKFLOW_PATH, buildSteps, "Checkout");
expectStep(PR_BUILD_WORKFLOW_PATH, buildSteps, "Install");
expectStep(PR_BUILD_WORKFLOW_PATH, buildSteps, "Typecheck package closure");
expectStep(PR_BUILD_WORKFLOW_PATH, buildSteps, "Login to GHCR");
expectStep(PR_BUILD_WORKFLOW_PATH, buildSteps, "Build app image");

expectEqual(PR_LINT_WORKFLOW_PATH, prLintWorkflow?.name, "Lint PR", "workflow name");
expectTrigger(PR_LINT_WORKFLOW_PATH, prLintWorkflow, "pull_request");
expectNoWorkflowDispatch(PR_LINT_WORKFLOW_PATH, prLintWorkflow);
