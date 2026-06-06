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
expectTrigger(PR_BUILD_WORKFLOW_PATH, prBuildWorkflow, "merge_group");
expectMainPush(PR_BUILD_WORKFLOW_PATH, prBuildWorkflow);
expectNoWorkflowDispatch(PR_BUILD_WORKFLOW_PATH, prBuildWorkflow);
expectEqual(PR_BUILD_WORKFLOW_PATH, prBuildWorkflow?.permissions?.contents, "read", "permissions.contents");
expectEqual(PR_BUILD_WORKFLOW_PATH, prBuildWorkflow?.permissions?.packages, "write", "permissions.packages");
expectIncludes(PR_BUILD_WORKFLOW_PATH, prBuildWorkflow?.concurrency?.group, "pr-build-pr-{0}", "concurrency.group");
expectIncludes(PR_BUILD_WORKFLOW_PATH, prBuildWorkflow?.concurrency?.group, "pr-build-mq-{0}", "concurrency.group");

const resolveJob = prBuildWorkflow?.jobs?.resolve;
if (!resolveJob) fail(PR_BUILD_WORKFLOW_PATH, "jobs must include resolve");
expectIncludes(
  PR_BUILD_WORKFLOW_PATH,
  resolveJob?.if,
  "github.event.pull_request.head.repo.full_name == github.repository",
  "jobs.resolve.if",
);
const resolveSteps = Array.isArray(resolveJob?.steps) ? resolveJob.steps : [];
const resolveStep = resolveSteps.find((step) => step?.id === "r");
const resolveRun = String(resolveStep?.run ?? "");
expectIncludes(PR_BUILD_WORKFLOW_PATH, resolveRun, 'IMAGE_TAG="pr-${PR_NUMBER}-${ORIGINAL_HEAD_SHA}"', "pull_request image tag");
expectIncludes(PR_BUILD_WORKFLOW_PATH, resolveRun, 'IMAGE_TAG="mq-${PR_NUMBER}-${BUILD_SHA}"', "merge_group image tag");
expectIncludes(PR_BUILD_WORKFLOW_PATH, resolveRun, 'IMAGE_TAG="sha-${BUILD_SHA}"', "push main image tag");
expectIncludes(PR_BUILD_WORKFLOW_PATH, resolveRun, 'image_name=ghcr.io/${owner_lc}/${repo_lc}-node', "node-owned image name");

const buildJob = prBuildWorkflow?.jobs?.build;
if (!buildJob) fail(PR_BUILD_WORKFLOW_PATH, "jobs must include build");
expectEqual(PR_BUILD_WORKFLOW_PATH, buildJob?.needs, "resolve", "jobs.build.needs");
const buildSteps = Array.isArray(buildJob?.steps) ? buildJob.steps : [];
expectStep(PR_BUILD_WORKFLOW_PATH, buildSteps, "Install dependencies");
expectStep(PR_BUILD_WORKFLOW_PATH, buildSteps, "Build workspace packages");
expectStep(PR_BUILD_WORKFLOW_PATH, buildSteps, "Set up Docker Buildx");
expectStep(PR_BUILD_WORKFLOW_PATH, buildSteps, "Login to GHCR");
const buildImage = expectStep(PR_BUILD_WORKFLOW_PATH, buildSteps, "Build and push node");
expectEqual(PR_BUILD_WORKFLOW_PATH, buildImage?.with?.push, true, "Build and push node push");
expectIncludes(PR_BUILD_WORKFLOW_PATH, buildImage?.with?.tags, "${{ needs.resolve.outputs.image_name }}:${{ needs.resolve.outputs.image_tag }}", "Build and push node tags");
expectStep(PR_BUILD_WORKFLOW_PATH, buildSteps, "Verify pushed image");

expectEqual(PR_LINT_WORKFLOW_PATH, prLintWorkflow?.name, "Lint PR", "workflow name");
const prLintPullRequest = expectTrigger(PR_LINT_WORKFLOW_PATH, prLintWorkflow, "pull_request");
const prLintTypes = Array.isArray(prLintPullRequest?.types) ? prLintPullRequest.types : [];
for (const type of ["opened", "edited", "reopened", "synchronize"]) {
  if (!prLintTypes.includes(type)) {
    fail(PR_LINT_WORKFLOW_PATH, `pull_request trigger must include ${type}`);
  }
}

const prLintJob = prLintWorkflow?.jobs?.main;
expectEqual(PR_LINT_WORKFLOW_PATH, prLintJob?.name, "Validate PR title", "job name");
expectEqual(PR_LINT_WORKFLOW_PATH, prLintJob?.permissions?.["pull-requests"], "read", "pull request permission");
const prLintSteps = Array.isArray(prLintJob?.steps) ? prLintJob.steps : [];
const semanticTitleStep = prLintSteps.find(
  (step) => step?.uses === "amannn/action-semantic-pull-request@v6",
);
expectEqual(
  PR_LINT_WORKFLOW_PATH,
  semanticTitleStep?.env?.GITHUB_TOKEN,
  "${{ secrets.GITHUB_TOKEN }}",
  "semantic PR title token",
);
for (const type of [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "chore",
  "revert",
  "ci",
  "build",
  "release",
]) {
  expectIncludes(PR_LINT_WORKFLOW_PATH, semanticTitleStep?.with?.types, type, "semantic PR title types");
}
expectIncludes(PR_LINT_WORKFLOW_PATH, semanticTitleStep?.with?.subjectPattern, "[Cc]omplete", "semantic PR title subjectPattern");
expectIncludes(
  PR_LINT_WORKFLOW_PATH,
  semanticTitleStep?.with?.subjectPattern,
  "[Pp]roduction[ ]+[Rr]eady",
  "semantic PR title subjectPattern",
);

if (process.exitCode) {
  process.exit();
}

console.log("CI workflow invariants passed");
console.log("PR Build workflow invariants passed");
console.log("PR lint workflow invariants passed");
