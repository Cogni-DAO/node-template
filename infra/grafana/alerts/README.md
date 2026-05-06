# Grafana Alerting

Grafana Git Sync does not currently sync alerting resources. Keep Grafana-managed alert rules, contact points, notification policies, mute timings, and templates here, then apply them through Terraform/OpenTofu or the Grafana alerting provisioning API.

Preferred shape:

```text
infra/grafana/alerts/
├── terraform/          # provider resources once Grafana credentials are wired
└── exports/            # reviewed exports from Grafana before conversion
```

Do not commit secrets, contact-point tokens, webhook URLs, or decrypted exports.
