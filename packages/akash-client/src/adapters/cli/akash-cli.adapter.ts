// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-client/adapters/cli`
 * Purpose: AkashDeployPort adapter that shells out to the `akash` CLI.
 * Scope: Adapter — translates port interface to CLI commands. Does NOT manage wallet keys directly.
 * Invariants:
 *   - CLI_DEPENDENCY: Requires `akash` binary in PATH.
 *   - WALLET_REQUIRED: All mutating operations need a funded Cosmos wallet.
 *   - IDEMPOTENT_READS: Query operations (getDeployment, listBids) are safe to retry.
 * Side-effects: IO
 * Links: docs/spec/akash-deploy-service.md
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  AkashClusterProvider,
  AkashConnection,
  AkashDeployPort,
} from "../../port/akash-deploy.port.js";
import type {
  Bid,
  CrewConfig,
  DeploymentInfo,
  SdlOutput,
} from "../../port/akash-deploy.schemas.js";
import { generateSdl } from "../../sdl/sdl-generator.js";

const execFileAsync = promisify(execFile);

interface AkashCliConfig {
  /** Path to akash binary (default: "akash") */
  binary?: string;
  /** Akash RPC node URL */
  node: string;
  /** Chain ID (default: "akashnet-2") */
  chainId?: string;
  /** Key name in akash keyring */
  keyName: string;
  /** Keyring backend (default: "test") */
  keyringBackend?: string;
  /** Home directory for akash config */
  home?: string;
  /** Gas adjustment multiplier */
  gasAdjustment?: string;
  /** Gas prices */
  gasPrices?: string;
}

function baseArgs(config: AkashCliConfig): string[] {
  return [
    "--node",
    config.node,
    "--chain-id",
    config.chainId ?? "akashnet-2",
    "--from",
    config.keyName,
    "--keyring-backend",
    config.keyringBackend ?? "test",
    ...(config.home ? ["--home", config.home] : []),
    "--gas-adjustment",
    config.gasAdjustment ?? "1.5",
    "--gas-prices",
    config.gasPrices ?? "0.025uakt",
    "--gas",
    "auto",
    "-y",
    "--output",
    "json",
  ];
}

async function runAkash(
  config: AkashCliConfig,
  args: string[]
): Promise<string> {
  const binary = config.binary ?? "akash";
  const { stdout } = await execFileAsync(binary, args, {
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

function parseDeploymentId(output: string): string {
  const parsed = JSON.parse(output) as {
    id?: { owner?: string; dseq?: string };
    deployment_id?: { owner?: string; dseq?: string };
  };
  const id = parsed.id ?? parsed.deployment_id;
  if (!id?.owner || !id?.dseq) {
    throw new Error(
      `Failed to parse deployment ID from: ${output.slice(0, 200)}`
    );
  }
  return `${id.owner}/${id.dseq}`;
}

export class AkashCliAdapter implements AkashDeployPort {
  constructor(private readonly config: AkashCliConfig) {}

  generateSdl(crew: CrewConfig): SdlOutput {
    return generateSdl(crew);
  }

  async createDeployment(sdlYaml: string): Promise<DeploymentInfo> {
    const tmpDir = await mkdtemp(join(tmpdir(), "akash-sdl-"));
    const sdlPath = join(tmpDir, "deploy.yaml");

    try {
      await writeFile(sdlPath, sdlYaml, "utf-8");

      const output = await runAkash(this.config, [
        "tx",
        "deployment",
        "create",
        sdlPath,
        ...baseArgs(this.config),
      ]);

      const deploymentId = parseDeploymentId(output);
      const now = new Date().toISOString();

      return {
        deploymentId,
        status: "pending",
        crewName: "",
        endpoints: {},
        createdAt: now,
        updatedAt: now,
      };
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  async listBids(deploymentId: string): Promise<Bid[]> {
    const [owner, dseq] = deploymentId.split("/");
    if (!owner || !dseq)
      throw new Error(`Invalid deploymentId: ${deploymentId}`);

    const output = await runAkash(this.config, [
      "query",
      "market",
      "bid",
      "list",
      "--owner",
      owner,
      "--dseq",
      dseq,
      "--node",
      this.config.node,
      "--output",
      "json",
    ]);

    const parsed = JSON.parse(output) as {
      bids?: Array<{
        bid?: {
          bid_id?: { provider?: string };
          price?: { amount?: string; denom?: string };
          state?: string;
        };
      }>;
    };

    return (parsed.bids ?? []).map((b) => ({
      provider: b.bid?.bid_id?.provider ?? "",
      price: {
        amount: b.bid?.price?.amount ?? "0",
        denom: b.bid?.price?.denom ?? "uakt",
      },
      state: b.bid?.state ?? "unknown",
    }));
  }

  async acceptBid(
    deploymentId: string,
    provider: string
  ): Promise<DeploymentInfo> {
    const [owner, dseq] = deploymentId.split("/");
    if (!owner || !dseq)
      throw new Error(`Invalid deploymentId: ${deploymentId}`);

    await runAkash(this.config, [
      "tx",
      "market",
      "lease",
      "create",
      "--owner",
      owner,
      "--dseq",
      dseq,
      "--gseq",
      "1",
      "--oseq",
      "1",
      "--provider",
      provider,
      ...baseArgs(this.config),
    ]);

    return {
      deploymentId,
      status: "active",
      crewName: "",
      provider,
      leaseId: `${owner}/${dseq}/1/1/${provider}`,
      endpoints: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async sendManifest(deploymentId: string, sdlYaml: string): Promise<void> {
    const [owner, dseq] = deploymentId.split("/");
    if (!owner || !dseq)
      throw new Error(`Invalid deploymentId: ${deploymentId}`);

    const tmpDir = await mkdtemp(join(tmpdir(), "akash-manifest-"));
    const sdlPath = join(tmpDir, "deploy.yaml");

    try {
      await writeFile(sdlPath, sdlYaml, "utf-8");

      await runAkash(this.config, [
        "provider",
        "send-manifest",
        sdlPath,
        "--owner",
        owner,
        "--dseq",
        dseq,
        "--gseq",
        "1",
        "--oseq",
        "1",
        "--node",
        this.config.node,
        "--from",
        this.config.keyName,
        "--keyring-backend",
        this.config.keyringBackend ?? "test",
        ...(this.config.home ? ["--home", this.config.home] : []),
      ]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  async getDeployment(deploymentId: string): Promise<DeploymentInfo> {
    const [owner, dseq] = deploymentId.split("/");
    if (!owner || !dseq)
      throw new Error(`Invalid deploymentId: ${deploymentId}`);

    const output = await runAkash(this.config, [
      "query",
      "deployment",
      "get",
      "--owner",
      owner,
      "--dseq",
      dseq,
      "--node",
      this.config.node,
      "--output",
      "json",
    ]);

    const parsed = JSON.parse(output) as {
      deployment?: { state?: string };
    };

    const stateMap: Record<string, DeploymentInfo["status"]> = {
      active: "active",
      closed: "closed",
    };
    const state = parsed.deployment?.state ?? "pending";

    return {
      deploymentId,
      status: stateMap[state] ?? "pending",
      crewName: "",
      endpoints: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async closeDeployment(deploymentId: string): Promise<DeploymentInfo> {
    const [owner, dseq] = deploymentId.split("/");
    if (!owner || !dseq)
      throw new Error(`Invalid deploymentId: ${deploymentId}`);

    await runAkash(this.config, [
      "tx",
      "deployment",
      "close",
      "--owner",
      owner,
      "--dseq",
      dseq,
      "--gseq",
      "1",
      "--oseq",
      "1",
      ...baseArgs(this.config),
    ]);

    return {
      deploymentId,
      status: "closed",
      crewName: "",
      endpoints: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async updateDeployment(
    deploymentId: string,
    sdlYaml: string
  ): Promise<DeploymentInfo> {
    const [owner, dseq] = deploymentId.split("/");
    if (!owner || !dseq)
      throw new Error(`Invalid deploymentId: ${deploymentId}`);

    const tmpDir = await mkdtemp(join(tmpdir(), "akash-update-"));
    const sdlPath = join(tmpDir, "deploy.yaml");

    try {
      await writeFile(sdlPath, sdlYaml, "utf-8");

      await runAkash(this.config, [
        "tx",
        "deployment",
        "update",
        sdlPath,
        "--owner",
        owner,
        "--dseq",
        dseq,
        ...baseArgs(this.config),
      ]);

      // Re-send manifest after update
      await this.sendManifest(deploymentId, sdlYaml);

      return {
        deploymentId,
        status: "active",
        crewName: "",
        endpoints: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}

/**
 * AkashClusterProvider — implements ClusterProvider interface from node-launch spec.
 * Bridges generic provisioning workflow to Akash-specific deployment.
 */
export class AkashSdlProvider implements AkashClusterProvider {
  constructor(private readonly deployer: AkashCliAdapter) {}

  async ensureCluster(env: string): Promise<AkashConnection> {
    // Akash is a marketplace — no cluster to provision.
    // Return RPC connection info for the chain.
    const rpcEndpoints: Record<string, string> = {
      mainnet: "https://rpc.akashnet.net:443",
      testnet: "https://rpc.testnet-02.aksh.pw:443",
    };

    return {
      rpcEndpoint: rpcEndpoints[env] ?? "https://rpc.akashnet.net:443",
      chainId: env === "testnet" ? "sandbox-01" : "akashnet-2",
      walletAddress: "", // Populated by wallet adapter
    };
  }

  async createNamespace(
    _conn: AkashConnection,
    name: string,
    crew: CrewConfig
  ): Promise<DeploymentInfo> {
    const sdl = this.deployer.generateSdl(crew);
    const deployment = await this.deployer.createDeployment(sdl.yaml);
    return { ...deployment, crewName: name };
  }

  async applyManifests(
    _conn: AkashConnection,
    deploymentId: string,
    sdlYaml: string
  ): Promise<void> {
    await this.deployer.updateDeployment(deploymentId, sdlYaml);
  }

  async createSecret(
    _conn: AkashConnection,
    _deploymentId: string,
    _data: Record<string, string>
  ): Promise<void> {
    // Akash injects secrets as env vars in SDL.
    // This is a no-op because secrets are baked into the SDL at generation time.
    // For runtime secret updates, the deployment must be updated with new SDL.
  }
}
