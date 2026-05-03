// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/app/CopyTargetControlPanel`
 * Purpose: Locks the dashboard's curated RN1/swisstony copy-target controls:
 *          both targets always render, active rows map to the live indicator,
 *          and toggles call the existing copy-target API.
 * Scope: Unit / jsdom with mocked fetch. Does not exercise wallet analysis.
 * Side-effects: none (mocked fetch).
 * Links: nodes/poly/app/src/app/(app)/dashboard/_components/CopyTargetControlPanel.tsx
 * @vitest-environment jsdom
 */

import "@testing-library/jest-dom/vitest";

import type {
  PolyCopyTradeTarget,
  PolyWalletGrantsGetOutput,
} from "@cogni/poly-node-contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CopyTargetControlPanel } from "@/app/(app)/dashboard/_components/CopyTargetControlPanel";

vi.mock("@/features/wallet-analysis", () => ({
  WalletQuickJump: (): ReactElement => <div>Open any wallet input</div>,
}));

const RN1 = "0x2005d16a84ceefa912d4e380cd32e7ff827875ea";
const SWISSTONY = "0x204f72f35326db932158cba6adff0b9a1da95e14";

function withClient(ui: ReactElement): ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function target(wallet: string, id: string): PolyCopyTradeTarget {
  return {
    target_id: id,
    target_wallet: wallet,
    mode: "live",
    mirror_usdc: 5,
    mirror_filter_percentile: 75,
    mirror_max_usdc_per_trade: 5,
    sizing_policy_kind: "target_percentile_scaled",
    source: "db",
  };
}

function grants(): PolyWalletGrantsGetOutput {
  return {
    connected: true,
    grant: {
      per_order_usdc_cap: 10,
      daily_usdc_cap: 100,
    },
  } as PolyWalletGrantsGetOutput;
}

function mockFetch(targets: PolyCopyTradeTarget[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/v1/poly/copy-trade/targets")) {
        if (init?.method === "POST") {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              target: target(SWISSTONY, "target-swisstony"),
            }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ targets }),
        } as Response;
      }
      if (url.includes("/api/v1/poly/copy-trade/targets/")) {
        return {
          ok: true,
          json: async () =>
            init?.method === "DELETE"
              ? { deleted: true }
              : { target: targets[0] },
        } as Response;
      }
      if (url.endsWith("/api/v1/poly/wallet/grants")) {
        return {
          ok: true,
          json: async () => grants(),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }
  );
  global.fetch = fetchMock;
  return fetchMock;
}

describe("CopyTargetControlPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to the compact RN1/swisstony status strip", async () => {
    mockFetch([]);
    render(withClient(<CopyTargetControlPanel />));

    expect(await screen.findByText("RN1 copy --")).toBeInTheDocument();
    expect(screen.getByText("swisstony copy --")).toBeInTheDocument();
    expect(screen.queryByText("Open any wallet input")).not.toBeInTheDocument();
  });

  it("always renders RN1 and swisstony controls after expand", async () => {
    mockFetch([]);
    render(withClient(<CopyTargetControlPanel />));

    fireEvent.click(await screen.findByLabelText("Expand copy controls"));

    expect(await screen.findByText("RN1")).toBeInTheDocument();
    expect(screen.getByText("swisstony")).toBeInTheDocument();
    expect(screen.getAllByRole("switch", { checked: false })).toHaveLength(2);
    expect(screen.getByText("Open any wallet input")).toBeInTheDocument();
  });

  it("maps active targets to the live indicator and toggles through existing APIs", async () => {
    const fetchMock = mockFetch([target(RN1, "target-rn1")]);
    render(withClient(<CopyTargetControlPanel />));

    fireEvent.click(await screen.findByLabelText("Expand copy controls"));

    expect(
      await screen.findByRole("switch", { name: "Pause RN1" })
    ).toBeChecked();
    expect(screen.getByText("active")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "Pause RN1" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/poly/copy-trade/targets/target-rn1",
        { method: "DELETE" }
      )
    );

    fireEvent.click(screen.getByRole("switch", { name: "Turn on swisstony" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/poly/copy-trade/targets",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ target_wallet: SWISSTONY }),
        })
      )
    );
  });

  it("collapses into a compact copy-target status strip", async () => {
    mockFetch([target(RN1, "target-rn1")]);
    render(withClient(<CopyTargetControlPanel />));

    expect(screen.getByLabelText("Expand copy controls")).toBeInTheDocument();
    expect(await screen.findByText("RN1 copy active")).toBeInTheDocument();
    expect(screen.getByText("swisstony copy --")).toBeInTheDocument();
    expect(screen.queryByText("Open any wallet input")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Expand copy controls"));
    expect(screen.getByText("Open any wallet input")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Collapse copy controls"));
    expect(screen.getByLabelText("Expand copy controls")).toBeInTheDocument();
  });

  it("keeps the global wallet-grant policy editable on the dashboard", async () => {
    const fetchMock = mockFetch([]);
    render(withClient(<CopyTargetControlPanel />));

    fireEvent.click(await screen.findByLabelText("Expand copy controls"));

    fireEvent.click(await screen.findByText("edit"));
    fireEvent.change(screen.getByLabelText("Per trade"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("Per day"), {
      target: { value: "120" },
    });
    fireEvent.click(screen.getAllByText("Save")[0] as HTMLElement);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/poly/wallet/grants",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            per_order_usdc_cap: 12,
            daily_usdc_cap: 120,
          }),
        })
      )
    );
  });
});
