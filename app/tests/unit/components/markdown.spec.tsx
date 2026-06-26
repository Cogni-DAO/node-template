// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/components/markdown.spec`
 * Purpose: Regression coverage for shared markdown presentation used by knowledge and work detail views.
 * Scope: Verifies markdown syntax renders structurally instead of displaying raw text.
 * Invariants: Knowledge/work text entries are markdown by default; GFM tables render without entry-level flags.
 * Side-effects: none
 * Links: app/src/components/markdown.tsx
 * @vitest-environment jsdom
 */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Markdown } from "@/components/markdown";

describe("Markdown", () => {
  it("renders markdown syntax as semantic content", () => {
    render(<Markdown content={"# Knowledge\n\nThis is **bold** and `code`."} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Knowledge" })
    ).toBeInTheDocument();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("code").tagName).toBe("CODE");
    expect(screen.queryByText("**bold**")).not.toBeInTheDocument();
  });

  it("renders GitHub-flavored markdown tables", () => {
    render(
      <Markdown
        content={[
          "| Item | State |",
          "| --- | --- |",
          "| Render markdown | Fixed |",
        ].join("\n")}
      />
    );

    const table = screen.getByRole("table");

    expect(
      within(table).getByRole("columnheader", { name: "Item" })
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: "State" })
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("cell", { name: "Render markdown" })
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("cell", { name: "Fixed" })
    ).toBeInTheDocument();
  });
});
