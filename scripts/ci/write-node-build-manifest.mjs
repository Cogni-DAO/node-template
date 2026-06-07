import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const required = ["MANIFEST_FILE", "IMAGE_NAME", "IMAGE_TAG", "SOURCE_SHA", "REPOSITORY"];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`${key} is required`);
  }
}

const fragmentsDir = process.env.FRAGMENTS_DIR ?? "";
const targets = [];
if (fragmentsDir && existsSync(fragmentsDir)) {
  for (const file of readdirSync(fragmentsDir).sort()) {
    if (!file.endsWith(".json")) continue;
    const payload = JSON.parse(readFileSync(join(fragmentsDir, file), "utf8"));
    targets.push(...(payload.targets ?? []));
  }
}

const manifest = {
  schema_version: 1,
  created_at: new Date().toISOString(),
  repository: process.env.REPOSITORY,
  head_sha: process.env.SOURCE_SHA,
  ref_name: process.env.REF_NAME ?? "",
  workflow: {
    name: process.env.WORKFLOW_NAME ?? "",
    run_id: process.env.RUN_ID ?? "",
    run_attempt: process.env.RUN_ATTEMPT ?? "",
  },
  image_name: process.env.IMAGE_NAME.toLowerCase(),
  image_tag: process.env.IMAGE_TAG,
  platform: "linux/amd64",
  targets,
};

mkdirSync(dirname(process.env.MANIFEST_FILE), { recursive: true });
writeFileSync(process.env.MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
