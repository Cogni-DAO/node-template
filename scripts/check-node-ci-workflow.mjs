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

expectEqual(workflow?.name, "Node CI", "workflow name");

const triggers = expectOwnKey(workflow, "on", "workflow");
expectOwnKey(triggers, "workflow_dispatch", "workflow triggers");
expectOwnKey(triggers, "pull_request", "workflow triggers");

const push = expectOwnKey(triggers, "push", "workflow triggers");
const branches = Array.isArray(push?.branches) ? push.branches : [];
if (!branches.includes("main")) {
  fail("push trigger must include main");
}

expectEqual(workflow?.permissions?.contents, "read", "permissions.contents");
expectEqual(workflow?.permissions?.packages, "write", "permissions.packages");
expectEqual(workflow?.env?.IMAGE_TAG, "sha-${{ github.sha }}", "env.IMAGE_TAG");

const steps = workflow?.jobs?.build?.steps;
if (!Array.isArray(steps)) {
  fail("jobs.build.steps must be a list");
  process.exit();
}

const imageMetadata = steps.find((step) => step?.name === "Prepare image metadata");
const imageMetadataRun = String(imageMetadata?.run ?? "");
const mainImagePublishCondition =
  "github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')";
if (!imageMetadataRun.includes('tr \'[:upper:]\' \'[:lower:]\'')) {
  fail("Prepare image metadata must lowercase the repository owner");
}
if (!imageMetadataRun.includes("ghcr.io/${owner_lc}/cogni-node-template")) {
  fail("Prepare image metadata must keep the image name ghcr.io/<owner>/cogni-node-template");
}

const ghcrLogin = steps.find((step) => step?.name === "Login to GHCR");
expectEqual(
  ghcrLogin?.if,
  mainImagePublishCondition,
  "Login to GHCR condition",
);
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
  "${{ github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch') }}",
  "Build app image push gate",
);
expectEqual(
  buildImage?.with?.tags,
  "${{ steps.image.outputs.name }}:${{ env.IMAGE_TAG }}",
  "Build app image tags",
);
if (!String(buildImage?.with?.["build-args"] ?? "").includes("BUILD_SHA=${{ github.sha }}")) {
  fail("Build app image must pass BUILD_SHA=${{ github.sha }}");
}

const verifyImage = steps.find((step) => step?.name === "Verify pushed image");
expectEqual(verifyImage?.if, mainImagePublishCondition, "Verify pushed image condition");
if (
  !String(verifyImage?.run ?? "").includes(
    'docker buildx imagetools inspect "${{ steps.image.outputs.name }}:${{ env.IMAGE_TAG }}"',
  )
) {
  fail("Verify pushed image must inspect the pushed image tag");
}

if (process.exitCode) {
  process.exit();
}

console.log("Node CI workflow invariants passed");
