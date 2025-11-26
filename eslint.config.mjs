// ARCHITECTURE + UI GOVERNANCE ONLY
// All other linting (TS, imports, React, a11y, filename conventions) handled by Biome
import app from "./eslint/app.config.mjs";
import base from "./eslint/base.config.mjs";
import noVendorSdkImports from "./eslint/no-vendor-sdk-imports.config.mjs";
import tests from "./eslint/tests.config.mjs";
import uiGovernance from "./eslint/ui-governance.config.mjs";

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...base,
  ...app,
  ...tests,
  ...uiGovernance,
  ...noVendorSdkImports,
];
