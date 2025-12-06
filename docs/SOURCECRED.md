# SourceCred Implementation Spec

## Implementation Status

- [x] **Phase 1: Infrastructure** (Service stack, Docker, CI/CD) - _Completed in PR #161_
- [x] **Phase 2: Configuration** (Weights, Grain, Plugins)
  - [x] `sourcecred.json`
  - [x] `currencyDetails.json`
  - [x] `github_config.json`
  - [x] `grain.json`
  - [x] `weights.json`
- [ ] **Phase 3: Verification** (Manual testing)

## Alignment Summary

### Agreed

- **GitHub-only plugin**: No Discord or Discourse integration.
- **Single Currency**: "AlphaCogni" only. No on-chain token in config.
- **Manual Approval**: All distributions require human sign-off (no auto-merge).
- **Signal-over-Noise**: Comments and low-signal surfaces are strongly de-weighted.

For the detailed "why" behind our configuration, see [SOURCECRED_CONFIG_RATIONALE.md](SOURCECRED_CONFIG_RATIONALE.md).

### Disagreed (Decisions)

- **Allocation Policy**: We use **RECENT + BALANCED** (vs RECENT-only).
- **Integration**: We use **Scoreboard-only v0** (vs CSV/Gnosis integration).
- **Reactions**: **Zero weight** for v0 (vs positive weight).
- **Balanced Budget**: **Capped budget share** (vs avoiding BALANCED).

## Configuration Specifications

### `grain.json`

- **Max Simultaneous Distributions**: `1`
- **Allocation Policies**:
  - `RECENT`: Budget `600`, Discount `0.6`
  - `BALANCED`: Budget `400`, Lookback `0`
- **Disabled**: `integration`, `accountingEnabled`

### `weights.json`

- **Adopt**: Node/Edge weights from standard architecture for ISSUE, PULL, REVIEW, COMMENT, COMMIT, BOT.
- **Override**: `reactionEdgeWeightsAll` = `0`

### `sourcecred.json`

- **Bundled Plugins**: `["sourcecred/github"]`

### `currencyDetails.json`

- **Name**: "CogniTemplate"
- **Suffix**: " COGTMP"
- **Integration**: `null`

### `github_config.json`

- **Repo**: `Cogni-DAO/cogni-template`
- **Include Developers**: `true`
- **Exclude Bots**: `true`

## Operational Invariants

> [!IMPORTANT]
> These invariants must be strictly maintained.

1.  **No Crypto Integration (v0)**: Do not enable CSV/Gnosis integration until an explicit Phase 2 decision.
2.  **Manual Distributions**: Never auto-merge grain PRs. Each distribution is a human-approved event.
3.  **Idle Handling**: Skip grain distributions (or leave PR unmerged) during idle periods.
4.  **Legacy Status**: Document SourceCred as legacy/temporary, with a migration plan to CogniCred.
5.  **Budget Safety**: Keep BALANCED budget share <= 40% and monitor for odd oscillations.
6.  **Identity**: Only add identities to ledger after CogniTemplate waiver/opt-in is recorded.

## File Pointers

- **Instance Config**: `platform/infra/services/sourcecred/instance/config`
- **Repositories**: `platform/infra/services/sourcecred/instance/config/plugins/sourcecred/github/config.json`
- **Docker**: `platform/infra/services/sourcecred/docker-compose.sourcecred.yml`
