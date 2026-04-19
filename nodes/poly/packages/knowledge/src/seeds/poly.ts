/**
 * Module: `@cogni/poly-knowledge/seeds/poly`
 * Purpose: Minimal protocol-fact seeds for the poly knowledge store.
 *   The knowledge store is designed to be filled by agents researching the
 *   domain over time — it is deliberately NOT seeded with strategy content.
 *   Only durable, externally-verifiable protocol facts live here.
 * Side-effects: none
 * @public
 */

import type { NewKnowledge } from "@cogni/knowledge-store";
import { CONFIDENCE } from "@cogni/ai-tools";

/** Base seeds inherited from node-template */
export { BASE_KNOWLEDGE_SEEDS } from "@cogni/node-template-knowledge";

/**
 * Poly-specific seeds — protocol facts only.
 *
 * Rationale: a knowledge store seeded with AI-authored strategy prose pollutes
 * retrieval (every search returns plausible-sounding noise the brain will
 * cite). Strategy, edge analysis, and market observations are the brain's job
 * to research, validate, and promote through its own confidence gate.
 *
 * Entries here must be: (1) externally verifiable, (2) about the protocol or
 * canonical data sources (not how to trade), (3) sourced to an authoritative
 * reference (official docs, Wikipedia, published datasets).
 */
export const POLY_KNOWLEDGE_SEEDS: NewKnowledge[] = [
  {
    id: "pm:protocol:clob-mechanics",
    domain: "prediction-market",
    title: "Polymarket uses a hybrid CLOB on Polygon with USDC settlement",
    content:
      "Polymarket's Central Limit Order Book operates via a custom exchange contract on Polygon. " +
      "Positions are denominated in USDC. Shares are binary CTF (Conditional Token Framework) tokens — " +
      "YES and NO shares for each market. A YES+NO pair always resolves to $1.00. " +
      "Trades settle on-chain; the order book is off-chain (operator-hosted matching engine). " +
      "Limit orders are free to place; market orders pay taker fees. " +
      "The Gamma API (REST) and CLOB API (WebSocket) provide market data and order book depth.",
    sourceType: "external",
    sourceRef: "https://docs.polymarket.com",
    confidencePct: CONFIDENCE.VERIFIED,
    tags: ["protocol", "clob", "polygon", "usdc"],
  },
  {
    id: "pm:protocol:kelly-formula",
    domain: "prediction-market",
    title: "Kelly criterion — canonical position-sizing formula",
    content:
      "Kelly formula: f* = (bp - q) / b, where b = net odds (payout/risk - 1), " +
      "p = estimated true probability, q = 1 - p. " +
      "f* is the fraction of bankroll that maximises expected log-growth. " +
      "Full-Kelly is the theoretical optimum; practitioners use fractional Kelly " +
      "(half or quarter) to account for estimation error. " +
      "This entry is a formula reference only — whether and how to apply Kelly in any specific " +
      "market is a modelling judgment, not encoded here.",
    sourceType: "external",
    sourceRef: "https://en.wikipedia.org/wiki/Kelly_criterion",
    confidencePct: CONFIDENCE.VERIFIED,
    tags: ["protocol", "sizing", "reference"],
  },
  {
    id: "pm:protocol:hf-datasets",
    domain: "prediction-market",
    title: "Polymarket on-chain history available as HuggingFace datasets",
    content:
      "Pre-built datasets for bulk / historical analysis: " +
      "SII-WANGZJ/Polymarket_data (full on-chain history, ~107GB), " +
      "CK0607/polymarket_10000 (market summaries), " +
      "AiYa1729/polymarket-transactions (transaction-level). " +
      "For live snapshots use the Gamma API (REST) and CLOB API (WebSocket). " +
      "Prefer these datasets over scraping — scraping is rate-limited and duplicates work already done.",
    sourceType: "external",
    sourceRef: "https://huggingface.co/datasets/SII-WANGZJ/Polymarket_data",
    confidencePct: CONFIDENCE.VERIFIED,
    tags: ["protocol", "data-sources", "datasets"],
  },
];
