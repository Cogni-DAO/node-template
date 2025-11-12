# DEPLOYMENT.md

## Cherry Servers Deployment

### Prerequisites

1. Get Cherry Servers API key from https://portal.cherryservers.com/settings/api-keys
2. **Clear the gate (choose one):**
   - Complete identity verification (KYC via iDenfy) at https://portal.cherryservers.com/teams/YOUR_TEAM_ID/identity-verification, OR
   - Top up account credit by €100+ via crypto (CoinGate checkout)
3. Generate SSH key: `ssh-keygen -t ed25519 -C "your@email.com" -f ~/.ssh/derekg_cogni_canary -N ""`

### Deploy

```bash
# Set auth
export CHERRY_AUTH_TOKEN=<your-api-key>

# Deploy infrastructure
cd infra/cherry
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your project_id
tofu init
tofu plan
tofu apply
```

### Multi-arch Build

```bash
docker buildx create --use >/dev/null 2>&1 || true
docker buildx build --platform linux/amd64,linux/arm64 -t ghcr.io/cogni-dao/cogni-template:v1 . --push
```

### Common Issues

- **Error 403: "Identity Verification of team owner is required"** - Cherry blocks crypto-paid VPS orders until either:
  - Team owner completes KYC identity verification in Client Portal, OR
  - Account has €100+ pre-topped credit via crypto payment
