/**
 * Module: `@cogni/poly-knowledge`
 * Purpose: Poly node knowledge schema and seeds (self-contained after repo split).
 * Side-effects: none
 * @public
 */

// Schema (Drizzle table definitions — drizzle-kit owns migrations)
export {
  citations,
  domains,
  knowledge,
  knowledgeContributions,
  sources,
} from "./schema.js";

// Seeds
export { BASE_KNOWLEDGE_SEEDS } from "./seeds/base.js";
export { BASE_DOMAIN_SEEDS } from "./seeds/domains.js";
export { POLY_KNOWLEDGE_SEEDS } from "./seeds/poly.js";
