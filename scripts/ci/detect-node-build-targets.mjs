import { appendFileSync } from "node:fs";

const repository = process.env.GITHUB_REPOSITORY ?? "unknown/node";
const repoName = repository.split("/").at(-1) ?? "node";
const target = repoName.toLowerCase();

writeOutput("has_targets", "true");
writeOutput("targets", target);
writeOutput("targets_json", JSON.stringify([target]));

function writeOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) {
    console.log(`${key}=${value}`);
    return;
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}
