---
description: Read your own node's logs through the operator proxy.
---

You read your node's logs through one operator endpoint, using your Cogni API key. You never touch Grafana or kube — the operator holds the Loki token and scopes every query to your node.

## The endpoint

```bash
curl -G "https://cognidao.org/api/v1/nodes/<node>/observability/logs" \
  -H "authorization: Bearer $COGNI_API_KEY" \
  --data-urlencode "env=candidate-a" \
  --data-urlencode 'query={service="app"} | json | level="error"'
```

- `<node>` — your node `slug` (= `.cogni/repo-spec.yaml` `intent.name`) or its `node_id` (the `node_id` field in the same file).
- `env` — `candidate-a`, `preview`, or `production`.
- `query` — full LogQL, URL-encoded. Same query you'd write directly against Loki.
- Empty `query` → your node's `app` stream (everything the node app emitted).

The operator **forces** `env`/`service`/`node` to your node and rejects out-of-scope selectors with a `400`. You can only ever see your own node — there is no way to read another node or shared infra through this path.

## Get a `developer` grant first

Reading logs needs a `developer` grant on the node. Request it; the owner approves:

```bash
curl -X POST "https://cognidao.org/api/v1/nodes/<node>/access-requests" \
  -H "authorization: Bearer $COGNI_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"role":"developer"}'
```

Until approved, the logs endpoint returns `403 authz_denied`.

## Example queries

URL-encode the `query` value (`--data-urlencode` does this for you).

- **All errors:** `{service="app"} | json | level="error"`
- **Trace one request by reqId:** `{service="app"} | json | reqId="<req-id>"`
- **A domain event by name:** `{service="app"} | json | event="<event.name>"`
- **Free-text grep:** `{service="app"} |= "timeout"`

## Reading the result

Results are raw Loki JSON lines — each entry is one structured log the node app emitted. Useful fields: `level`, `event`, `reqId`, `nodeId`, `msg`, `time`. Your node already stamps `nodeId` (the repo-spec `node_id`) on every line — you configure nothing; the operator + env substrate handle scoping.

## Scope limit

This path serves only your node's **`app`** logs. Shared infra (operator, scheduler-worker, ingress, the database) is **operator-only** and not visible here. If you suspect a problem in shared infra, escalate with a bug:

```bash
POST https://cognidao.org/api/v1/work/items {type:"bug", node:"operator"}
```
