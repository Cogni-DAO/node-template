// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/components/kit/policy/PolicyControls`
 * Purpose: Unit tests for `<PolicyControls>` — render in editable + readonly modes, validate `daily >= per_order`, surface `{code: "invalid_caps"}` rejection inline.
 * Scope: Component-only. No fetch, no React Query. Asserts callback shape and visible markup.
 * Invariants: NUMERIC_VALIDATION; SAVE_REJECT_RENDERS_INLINE_ERROR.
 * Side-effects: none (no fetch).
 * Links: nodes/poly/app/src/components/kit/policy/PolicyControls.tsx,
 *        work/items/task.0347.poly-wallet-preferences-sizing-config.md
 */

// @vitest-environment happy-dom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PolicyControls } from "@/components/kit/policy/PolicyControls";

const baseValues = { per_order_usdc_cap: 5, daily_usdc_cap: 50 };

describe("PolicyControls", () => {
  it("renders readonly mode with values + 'Edit on Money' link", () => {
    render(<PolicyControls values={baseValues} readonly />);
    expect(screen.getByText("Per trade")).toBeInTheDocument();
    expect(screen.getByText("$5.00")).toBeInTheDocument();
    expect(screen.getByText("$50.00")).toBeInTheDocument();
    expect(screen.queryByText("edit")).not.toBeInTheDocument();
    expect(screen.getByText(/Edit on Money/)).toBeInTheDocument();
  });

  it("renders editable mode with 'edit' affordance and no link", () => {
    render(<PolicyControls values={baseValues} onSave={async () => {}} />);
    expect(screen.getByText("edit")).toBeInTheDocument();
    expect(screen.queryByText(/Edit on Money/)).not.toBeInTheDocument();
  });

  it("calls onSave with parsed numbers when valid", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PolicyControls values={baseValues} onSave={onSave} />);
    fireEvent.click(screen.getByText("edit"));
    const perOrderInput = screen.getByLabelText(
      "Per trade"
    ) as HTMLInputElement;
    const dailyInput = screen.getByLabelText("Per day") as HTMLInputElement;
    fireEvent.change(perOrderInput, { target: { value: "3" } });
    fireEvent.change(dailyInput, { target: { value: "30" } });
    fireEvent.click(screen.getByText("Save"));
    await new Promise((r) => setTimeout(r, 0));
    expect(onSave).toHaveBeenCalledWith({
      per_order_usdc_cap: 3,
      daily_usdc_cap: 30,
    });
  });

  it("blocks save when daily < per_order and surfaces inline error", async () => {
    const onSave = vi.fn();
    render(<PolicyControls values={baseValues} onSave={onSave} />);
    fireEvent.click(screen.getByText("edit"));
    const perOrderInput = screen.getByLabelText(
      "Per trade"
    ) as HTMLInputElement;
    const dailyInput = screen.getByLabelText("Per day") as HTMLInputElement;
    fireEvent.change(perOrderInput, { target: { value: "10" } });
    fireEvent.change(dailyInput, { target: { value: "5" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByText("Per day must be at least Per trade")
    ).toBeInTheDocument();
  });

  it("renders inline error when save rejects with {code: 'invalid_caps'}", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("daily < per_order"), { code: "invalid_caps" })
      );
    render(<PolicyControls values={baseValues} onSave={onSave} />);
    fireEvent.click(screen.getByText("edit"));
    fireEvent.click(screen.getByText("Save"));
    await new Promise((r) => setTimeout(r, 0));
    expect(
      screen.getByText("Per day must be at least Per trade")
    ).toBeInTheDocument();
  });

  it("surfaces generic message when save rejects without invalid_caps", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("network down"));
    render(<PolicyControls values={baseValues} onSave={onSave} />);
    fireEvent.click(screen.getByText("edit"));
    fireEvent.click(screen.getByText("Save"));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText("Save failed — try again")).toBeInTheDocument();
  });
});
