"use client";

import { createContext, type ReactNode, useContext } from "react";

import type { NodeAppConfig } from "./types";

const NodeAppContext = createContext<NodeAppConfig | null>(null);

/** Provides node configuration to the component tree. */
export function NodeAppProvider({
  config,
  children,
}: {
  readonly config: NodeAppConfig;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <NodeAppContext.Provider value={config}>{children}</NodeAppContext.Provider>
  );
}

/** Read the current node's configuration. Throws if used outside NodeAppProvider. */
export function useNodeAppConfig(): NodeAppConfig {
  const config = useContext(NodeAppContext);
  if (!config) {
    throw new Error("useNodeAppConfig must be used within a NodeAppProvider.");
  }
  return config;
}
