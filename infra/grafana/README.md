# Grafana as Code

Grafana-owned observability resources live here because they are infrastructure/operator assets, not node app code. Node apps emit logs and metrics; Grafana turns those signals into operational views and alerts.

## Layout

```text
infra/grafana/
├── dashboards/
│   ├── operator/       # cross-node, deployment, platform, and agent-loop dashboards
│   └── nodes/<node>/   # node-specific dashboards such as poly or resy
└── alerts/             # Grafana-managed alerting resources, provisioned outside Git Sync
```

## Git Sync

Configure the Grafana Git Sync repository resource to this repo, target branch `main`, and path:

```text
infra/grafana/dashboards/
```

Grafana Git Sync currently synchronizes dashboards and folders only. Alerts, data sources, and other resources are not supported by Git Sync, so alerting definitions belong in `infra/grafana/alerts/` and should be applied with Terraform/OpenTofu or Grafana's alerting provisioning API.

## Ownership

- Use `dashboards/operator/` for platform-wide dashboards: deploy health, candidate validation, all-node RED/USE views, Loki validation coverage, and Grafana Cloud spend.
- Use `dashboards/nodes/<node>/` only when the dashboard is meaningful for one node's domain and should not be mixed with platform/operator views.
- Do not place Grafana resources under `nodes/operator/`; that app is a product surface, while these files configure external observability.
- Do not place Cloud Git Sync dashboards under `infra/compose/runtime/configs/grafana-provisioning/`; that directory is local Grafana provisioning for the dev stack.

## Local Preview

The local dev Grafana container provisions dashboards from `infra/grafana/dashboards/` at startup. Start it with:

```bash
pnpm dev:infra
```

Then open `http://localhost:3001`.
