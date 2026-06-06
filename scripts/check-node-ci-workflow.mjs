import { readFileSync } from "node:fs";
import { parse } from "yaml";

const WORKFLOW_PATH = ".github/workflows/ci.yaml";
const workflow = parse(readFileSync(WORKFLOW_PATH, "utf8"));

function fail(message) {
  console.error(`${WORKFLOW_PATH}: ${message}`);
  process.exitCode = 1;
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} must be ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`);
  }
}

function expectOwnKey(object, key, label) {
  if (!object || typeof object !== "object" || !Object.hasOwn(object, key)) {
    fail(`${label} must define ${key}`);
    return undefined;
  }
  return object[key];
}

function expectIncludes(value, fragment, label) {
  if (!String(value ?? "").includes(fragment)) {
    fail(`${label} must include ${JSON.stringify(fragment)}`);
  }
}

expectEqual(workflow?.name, "Node CI", "workflow name");

const triggers = expectOwnKey(workflow, "on", "workflow");
expectOwnKey(triggers, "pull_request", "workflow triggers");
expectOwnKey(triggers, "merge_group", "workflow triggers");
if (Object.hasOwn(triggers ?? {}, "workflow_dispatch")) {
  fail("workflow triggers must not use workflow_dispatch as an image-publish path");
}

const push = expectOwnKey(triggers, "push", "workflow triggers");
const branches = Array.isArray(push?.branches) ? push.branches : [];
if (!branches.includes("main")) {
  fail("push trigger must include main");
}

expectEqual(workflow?.permissions?.contents, "read", "permissions.contents");
expectEqual(workflow?.permissions?.packages, "write", "permissions.packages");
if (Object.hasOwn(workflow ?? {}, "env") && Object.hasOwn(workflow.env ?? {}, "IMAGE_TAG")) {
  fail("workflow must derive IMAGE_TAG from event metadata, not a top-level default");
}
expectIncludes(workflow?.concurrency?.group, "node-ci-pr-{0}", "concurrency.group");
expectIncludes(workflow?.concurrency?.group, "node-ci-mq-{0}", "concurrency.group");
expectIncludes(workflow?.concurrency?.group, "github.ref", "concurrency.group");
expectEqual(workflow?.concurrency?.["cancel-in-progress"], true, "concurrency.cancel-in-progress");

const job = workflow?.jobs?.build;
expectIncludes(
  job?.if,
  "github.event.pull_request.head.repo.full_name == github.repository",
  "jobs.build.if",
);

const steps = job?.steps;
if (!Array.isArray(steps)) {
  fail("jobs.build.steps must be a list");
  process.exit();
}

const meta = steps.find((step) => step?.name === "Resolve build metadata");
expectEqual(meta?.id, "meta", "Resolve build metadata id");
const metaRun = String(meta?.run ?? "");
expectIncludes(metaRun, "IMAGE_TAG=\"pr-${PR_NUMBER}-${PR_HEAD_SHA}\"", "pull_request image tag");
expectIncludes(metaRun, "IMAGE_TAG=\"mq-${PR_NUMBER}-${PUSH_SHA}\"", "merge_group image tag");
expectIncludes(metaRun, "IMAGE_TAG=\"sha-${PUSH_SHA}\"", "push main image tag");
expectIncludes(metaRun, "BUILD_SHA=\"$PR_HEAD_SHA\"", "pull_request build SHA");
expectIncludes(metaRun, "BUILD_SHA=\"$PUSH_SHA\"", "push/merge_group build SHA");

const checkout = steps.find((step) => step?.name === "Checkout");
expectEqual(
  checkout?.uses,
  "actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955",
  "Checkout action",
);
expectEqual(
  checkout?.with?.ref,
  "${{ steps.meta.outputs.checkout_ref }}",
  "Checkout ref",
);

const pnpmSetup = steps.find((step) => step?.name === "Set up pnpm");
expectEqual(
  pnpmSetup?.uses,
  "pnpm/action-setup@c5ba7f7862a0f64c1b1a05fbac13e0b8e86ba08c",
  "Set up pnpm action",
);

const nodeSetup = steps.find((step) => step?.name === "Set up Node");
expectEqual(
  nodeSetup?.uses,
  "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  "Set up Node action",
);

const imageMetadata = steps.find((step) => step?.name === "Prepare image metadata");
const imageMetadataRun = String(imageMetadata?.run ?? "");
expectIncludes(imageMetadataRun, 'tr \'[:upper:]\' \'[:lower:]\'', "Prepare image metadata");
expectIncludes(
  imageMetadataRun,
  'repo_lc="$(printf \'%s\' "${GITHUB_REPOSITORY#*/}"',
  "Prepare image metadata",
);
expectIncludes(
  imageMetadataRun,
  "ghcr.io/${owner_lc}/${repo_lc}",
  "Prepare image metadata",
);

const ghcrLogin = steps.find((step) => step?.name === "Login to GHCR");
expectEqual(ghcrLogin?.if, "steps.meta.outputs.push_image == 'true'", "Login to GHCR condition");
expectEqual(ghcrLogin?.uses, "docker/login-action@v3", "Login to GHCR action");
expectEqual(ghcrLogin?.with?.registry, "ghcr.io", "Login to GHCR registry");
expectEqual(ghcrLogin?.with?.username, "${{ github.actor }}", "Login to GHCR username");
expectEqual(
  ghcrLogin?.with?.password,
  "${{ secrets.GITHUB_TOKEN }}",
  "Login to GHCR password",
);

const buildImage = steps.find((step) => step?.name === "Build app image");
expectEqual(buildImage?.uses, "docker/build-push-action@v6", "Build app image action");
expectEqual(buildImage?.with?.target, "runner", "Build app image target");
expectEqual(
  buildImage?.with?.push,
  "${{ steps.meta.outputs.push_image == 'true' }}",
  "Build app image push gate",
);
expectEqual(
  buildImage?.with?.tags,
  "${{ steps.image.outputs.name }}:${{ steps.meta.outputs.image_tag }}",
  "Build app image tags",
);
expectIncludes(
  buildImage?.with?.["build-args"],
  "BUILD_SHA=${{ steps.meta.outputs.build_sha }}",
  "Build app image build args",
);

const verifyImage = steps.find((step) => step?.name === "Verify pushed image");
expectEqual(
  verifyImage?.if,
  "steps.meta.outputs.push_image == 'true'",
  "Verify pushed image condition",
);
expectIncludes(
  verifyImage?.run,
  'docker buildx imagetools inspect "${{ steps.image.outputs.name }}:${{ steps.meta.outputs.image_tag }}"',
  "Verify pushed image",
);

if (process.exitCode) {
  process.exit();
}

console.log("Node CI workflow invariants passed");
