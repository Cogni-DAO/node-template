// .dependency-cruiser.cjs
// Hexagonal architecture boundaries enforced via dependency-cruiser.
// Pure policy config - scope controlled via CLI --include-only flag.
// Layer regexes use nodes/[^/]+/app/src to apply enforcement to ANY node directory;
// forks inherit the rules with no edit needed.
// Production: depcruise nodes/*/app/src packages services --include-only '^(nodes/[^/]+/app/src|packages|services)' --output-type err-long
// Arch probes: depcruise nodes/*/app/src/__arch_probes__ --include-only '^nodes/[^/]+/app/src/__arch_probes__' --output-type err

/** @type {import('dependency-cruiser').IConfiguration} */

// src/ hexagonal layers — apply to ANY node under nodes/<name>/app/src
const NODE_SRC = "nodes/[^/]+/app/src";
const srcLayers = {
  core: `^${NODE_SRC}/core`,
  ports: `^${NODE_SRC}/ports`,
  features: `^${NODE_SRC}/features`,
  app: `^${NODE_SRC}/app`,
  adapters: `^${NODE_SRC}/adapters`,
  adaptersServer: `^${NODE_SRC}/adapters/server`,
  adaptersTest: `^${NODE_SRC}/adapters/test`,
  shared: `^${NODE_SRC}/shared`,
  bootstrap: `^${NODE_SRC}/bootstrap`,
  lib: `^${NODE_SRC}/lib`,
  auth: `^${NODE_SRC}/auth\\.ts$`,
  proxy: `^${NODE_SRC}/proxy\\.ts$`,
  components: `^${NODE_SRC}/components`,
  styles: `^${NODE_SRC}/styles`,
  types: `^${NODE_SRC}/types`,
  assets: `^${NODE_SRC}/assets`,
  contracts: `^${NODE_SRC}/contracts`,
  mcp: `^${NODE_SRC}/mcp`,
  scripts: `^${NODE_SRC}/scripts`,
};

// Monorepo boundary layers (packages/)
const monorepoLayers = {
  packages: "^packages/",
  nodes: "^nodes/",
};

const layers = { ...srcLayers, ...monorepoLayers };

// Only src/ layers are checked for "unknown layer" violations
const knownSrcLayerPatterns = Object.values(srcLayers);

module.exports = {
  options: {
    tsConfig: {
      fileName: "./tsconfig.base.json",
    },
    tsPreCompilationDeps: true,
    doNotFollow: {
      path: "node_modules",
    },
  },

  allowedSeverity: "error",

  allowed: [
    // core → core, types
    {
      from: { path: layers.core },
      to: { path: [layers.core, layers.types] },
    },

    // ports → ports, core, types
    {
      from: { path: layers.ports },
      to: { path: [layers.ports, layers.core, layers.types] },
    },

    // features → features, ports, core, shared, types, components, contracts
    {
      from: { path: layers.features },
      to: {
        path: [
          layers.features,
          layers.ports,
          layers.core,
          layers.shared,
          layers.types,
          layers.components,
          layers.contracts,
        ],
      },
    },

    // contracts → contracts, shared, types
    {
      from: { path: layers.contracts },
      to: { path: [layers.contracts, layers.shared, layers.types] },
    },

    // app → app, features, ports, shared, lib, contracts, types, components, styles, bootstrap, auth
    {
      from: { path: layers.app },
      to: {
        path: [
          layers.app,
          layers.features,
          layers.ports,
          layers.shared,
          layers.lib,
          layers.contracts,
          layers.types,
          layers.components,
          layers.styles,
          layers.bootstrap,
          layers.auth,
        ],
      },
    },

    // lib → lib, ports, shared, types, auth
    {
      from: { path: layers.lib },
      to: {
        path: [
          layers.lib,
          layers.ports,
          layers.shared,
          layers.types,
          layers.auth,
        ],
      },
    },

    // auth → auth, adapters, shared, types
    {
      from: { path: layers.auth },
      to: {
        path: [layers.auth, layers.adapters, layers.shared, layers.types],
      },
    },

    // proxy → auth, lib, shared, types
    {
      from: { path: layers.proxy },
      to: { path: [layers.auth, layers.lib, layers.shared, layers.types] },
    },

    // mcp → mcp, features, ports, contracts, bootstrap
    {
      from: { path: layers.mcp },
      to: {
        path: [
          layers.mcp,
          layers.features,
          layers.ports,
          layers.contracts,
          layers.bootstrap,
        ],
      },
    },

    // adapters/server → adapters/server, ports, shared, types
    {
      from: { path: layers.adaptersServer },
      to: {
        path: [
          layers.adaptersServer,
          layers.ports,
          layers.shared,
          layers.types,
        ],
      },
    },

    // adapters/test → adapters/test, ports, shared, types
    {
      from: { path: layers.adaptersTest },
      to: {
        path: [layers.adaptersTest, layers.ports, layers.shared, layers.types],
      },
    },

    // shared → shared, types
    {
      from: { path: layers.shared },
      to: { path: [layers.shared, layers.types] },
    },

    // bootstrap → bootstrap, ports, adapters, shared, types
    {
      from: { path: layers.bootstrap },
      to: {
        path: [
          layers.bootstrap,
          layers.ports,
          layers.adapters,
          layers.shared,
          layers.types,
        ],
      },
    },

    // components → components, shared, types, styles
    {
      from: { path: layers.components },
      to: {
        path: [layers.components, layers.shared, layers.types, layers.styles],
      },
    },

    {
      from: { path: layers.styles },
      to: { path: [layers.styles] },
    },

    {
      from: { path: layers.assets },
      to: { path: [layers.assets] },
    },

    {
      from: { path: layers.types },
      to: { path: [layers.types] },
    },

    // =========================================================================
    // Monorepo package rules
    // =========================================================================

    {
      from: { path: "^packages/" },
      to: { path: "^packages/" },
    },

    {
      from: { path: `^${NODE_SRC}/` },
      to: { path: "^packages/" },
    },

    {
      from: { path: "^services/" },
      to: { path: "^packages/" },
    },

    {
      from: { path: "^services/" },
      to: { path: "^services/" },
    },

    // nodes/ can import within itself, EXCEPT app/src/ which has full layer enforcement above.
    {
      from: { path: "^nodes/(?![^/]+/app/src/)" },
      to: { path: "^nodes/" },
    },

    {
      from: { path: "^nodes/" },
      to: { path: "^packages/" },
    },

    // scripts → bootstrap
    {
      from: { path: `^${NODE_SRC}/scripts` },
      to: { path: [`^${NODE_SRC}/bootstrap`] },
    },
  ],

  forbidden: [
    // Enforce "no-unknown-files": any file in nodes/*/app/src/** not covered by a known layer pattern is an error.
    {
      name: "no-unknown-src-layer",
      severity: "error",
      from: {
        path: `^${NODE_SRC}`,
        pathNot: knownSrcLayerPatterns,
      },
      to: {},
    },

    // Block parent-relative imports
    {
      severity: "error",
      from: {
        path: `^${NODE_SRC}`,
      },
      to: {
        path: "\\.\\./",
      },
    },

    // Entry point: ports must use @/ports (index.ts) or @/ports/server.ts
    {
      name: "no-internal-ports-imports",
      severity: "error",
      from: {
        path: `^${NODE_SRC}/(?!ports/)`,
      },
      to: {
        path: `^${NODE_SRC}/ports/(?!index\\.ts$|server\\.ts$).*\\.ts$`,
      },
      comment:
        "Import from @/ports (index.ts) or @/ports/server (server-only), not internal port files",
    },

    // core: must use @/core (public.ts), not internal core files
    {
      name: "no-internal-core-imports",
      severity: "error",
      from: {
        path: `^${NODE_SRC}/(?!core/)`,
      },
      to: {
        path: `^${NODE_SRC}/core/(?!public\\.ts$).*\\.ts$`,
      },
      comment: "Import from @/core (public.ts), not internal core files",
    },

    // adapters/server: must use @/adapters/server (index.ts), not internal files
    {
      name: "no-internal-adapter-imports",
      severity: "error",
      from: {
        path: `^${NODE_SRC}/(?!adapters/server/)(?!auth\\.ts$)(?!bootstrap/container\\.ts$)(?!bootstrap/graph-executor\\.factory\\.ts$)(?!bootstrap/review-adapter\\.factory\\.ts$)(?!bootstrap/agent-discovery\\.ts$)(?!bootstrap/jobs/syncGovernanceSchedules\\.job\\.ts$)`,
      },
      to: {
        path: `^${NODE_SRC}/adapters/server/(?!index\\.ts$).*\\.ts$`,
      },
      comment:
        "Import from @/adapters/server (index.ts), not internal adapter files",
    },

    // adapters/test: must use @/adapters/test (index.ts), not internal files
    {
      name: "no-internal-test-adapter-imports",
      severity: "error",
      from: {
        path: `^${NODE_SRC}/(?!adapters/test/)`,
      },
      to: {
        path: `^${NODE_SRC}/adapters/test/(?!index\\.ts$).*\\.ts$`,
      },
      comment:
        "Import from @/adapters/test (index.ts), not internal test adapter files",
    },

    // features: only allow services/ and components/ subdirectories
    {
      name: "no-internal-features-imports",
      severity: "error",
      from: {
        path: `^${NODE_SRC}/(?!features/)`,
      },
      to: {
        path: `^${NODE_SRC}/features/[^/]+/(mappers|utils|constants)/`,
      },
      comment:
        "Only import from features/*/services or features/*/components subdirectories",
    },

    // AI _facades: must import from features/ai/public.ts
    {
      name: "no-ai-facades-to-feature-services",
      severity: "error",
      from: {
        path: `^${NODE_SRC}/app/_facades/ai/`,
      },
      to: {
        path: `^${NODE_SRC}/features/ai/services/`,
      },
      comment:
        "AI app facades must import from features/ai/public.ts, not internal services",
    },

    // =========================================================================
    // Monorepo boundary rules
    // =========================================================================

    {
      name: "no-packages-to-src-or-services",
      severity: "error",
      from: {
        path: "^packages/",
      },
      to: {
        path: [`^${NODE_SRC}/`, "^services/"],
      },
      comment:
        "packages/ must be standalone; cannot depend on src/ or services/",
    },

    {
      name: "no-services-to-src",
      severity: "error",
      from: {
        path: "^services/",
      },
      to: {
        path: `^${NODE_SRC}/`,
      },
      comment: "services/ cannot depend on Next.js app code in src/",
    },

    // shared packages cannot depend on node-specific code
    {
      name: "shared-not-node",
      severity: "error",
      from: {
        path: "^packages/",
      },
      to: {
        path: "^nodes/",
      },
      comment: "packages/ are shared and must not depend on node-specific code",
    },

    // nodes cannot import other nodes (except itself)
    {
      name: "no-cross-node",
      severity: "error",
      from: {
        path: "^nodes/([^/]+)/",
      },
      to: {
        path: "^nodes/([^/]+)/",
        pathNot: "^nodes/$1/",
      },
      comment: "node code must not import from another node directory",
    },

    {
      name: "no-src-to-services",
      severity: "error",
      from: {
        path: `^${NODE_SRC}/`,
      },
      to: {
        path: "^services/",
      },
      comment: "src/ cannot depend on standalone services",
    },

    // Block deep imports into package internals (force use of package exports)
    {
      name: "no-deep-package-imports",
      severity: "error",
      from: {
        path: `^${NODE_SRC}/`,
      },
      to: {
        path: "^packages/[^/]+/src/(?!index\\.ts$)",
        pathNot: "^packages/db-client/(src|dist)/service\\.(ts|js)$",
      },
      comment:
        "Import from package root or declared sub-path exports, not internal paths",
    },

    // =========================================================================
    // ai-core kernel boundary
    // =========================================================================

    {
      name: "no-ai-core-to-ai-tools",
      severity: "error",
      from: {
        path: "^packages/ai-core/",
      },
      to: {
        path: "^packages/ai-tools/",
      },
      comment:
        "ai-core defines runtime interfaces; ai-tools implements them. No reverse dependency.",
    },

    {
      name: "no-graphs-to-ai-core",
      severity: "error",
      from: {
        path: "^packages/langgraph-graphs/src/graphs/",
      },
      to: {
        path: "^packages/ai-core/",
      },
      comment:
        "Graph code uses ToolExecFn via runtime layer. Direct ai-core imports would bypass toolRunner.",
    },

    // =========================================================================
    // Scheduler package boundary rules
    // =========================================================================

    {
      name: "no-refs-to-slices",
      severity: "error",
      from: {
        path: "^packages/db-schema/src/refs",
      },
      to: {
        path: "^packages/db-schema/src/(scheduling|auth|billing|ai)",
      },
      comment: "refs.ts is the FK root; must not import from domain slices",
    },

    {
      name: "no-cross-slice-schema-imports",
      severity: "error",
      from: {
        path: "^packages/db-schema/src/(scheduling|auth|billing|ai)\\.ts$",
      },
      to: {
        path: "^packages/db-schema/src/(scheduling|auth|billing|ai)\\.ts$",
      },
      comment: "Domain slices import from /refs only, never from each other",
    },

    // db-client server-only
    {
      name: "db-client-server-only",
      severity: "error",
      from: {
        path: `^${NODE_SRC}/(features|components|core|styles|assets)/`,
      },
      to: {
        path: "^packages/db-client/",
      },
      comment:
        "db-client contains postgres/drizzle; only server layers may import",
    },

    {
      name: "no-service-db-package-import",
      severity: "error",
      from: {
        path: `^${NODE_SRC}/`,
        pathNot: `^${NODE_SRC}/adapters/server/db/drizzle\\.service-client\\.ts$`,
      },
      to: {
        path: "^packages/db-client/(src|dist)/service\\.(ts|js)$",
      },
      comment:
        "Only drizzle.service-client.ts may import @cogni/db-client/service (BYPASSRLS)",
    },

    {
      name: "no-service-db-adapter-import",
      severity: "error",
      from: {
        path: `^${NODE_SRC}/`,
        pathNot: `^${NODE_SRC}/(auth\\.ts|bootstrap/container\\.ts|bootstrap/jobs/syncGovernanceSchedules\\.job\\.ts)$`,
      },
      to: {
        path: `^${NODE_SRC}/adapters/server/db/drizzle\\.service-client\\.ts$`,
      },
      comment:
        "Only auth.ts, container.ts, and governance job may import the service-db adapter",
    },

    // =========================================================================
    // Services internal clean architecture
    // =========================================================================

    {
      name: "no-service-core-or-ports-to-adapters",
      severity: "error",
      from: {
        path: "^services/[^/]+/src/(core|ports)/",
      },
      to: {
        path: "^services/[^/]+/src/adapters/",
      },
      comment: "core/ports cannot depend on adapters (clean architecture)",
    },

    {
      name: "no-service-adapters-to-main",
      severity: "error",
      from: {
        path: "^services/[^/]+/src/adapters/",
      },
      to: {
        path: "^services/[^/]+/src/main\\.ts$",
      },
      comment: "adapters must not import the composition root",
    },

    {
      name: "no-service-activities-to-adapters",
      severity: "error",
      from: {
        path: "^services/[^/]+/src/(activities|workflows)/",
      },
      to: {
        path: "^services/[^/]+/src/adapters/",
      },
      comment:
        "activities/workflows depend on ports, not adapters (clean architecture)",
    },

    {
      name: "no-service-activities-to-db-client",
      severity: "error",
      from: {
        path: "^services/[^/]+/src/(activities|workflows)/",
      },
      to: {
        path: "^packages/db-client/",
      },
      comment:
        "activities/workflows use port interfaces, not concrete DB adapters",
    },

    {
      name: "no-service-activities-to-bootstrap",
      severity: "error",
      from: {
        path: "^services/[^/]+/src/(activities|workflows)/",
      },
      to: {
        path: "^services/[^/]+/src/bootstrap/",
      },
      comment: "activities/workflows must not reach into the composition root",
    },
  ],
};
