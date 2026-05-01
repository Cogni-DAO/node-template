// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-market-provider/tests/polymarket-ws-client`
 * Purpose: Unit tests for the Polymarket Market-channel WebSocket client protocol frames.
 * Scope: Pure fake-WebSocket tests. Does not open network sockets.
 * Invariants: Initial subscription uses `{assets_ids,type:"market"}`; dynamic updates use `{operation,assets_ids}`; heartbeat sends `PING` every 10s.
 * Side-effects: fake timers only.
 * Links: docs https://docs.polymarket.com/market-data/websocket/overview
 * @internal
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createPolymarketWsClient } from "../src/adapters/polymarket/index.js";
import { noopLogger } from "../src/port/observability.port.js";

type Listener = (event: unknown) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readonly sent: string[] = [];
  readonly url: string;
  readyState = 0;

  private readonly listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.dispatch("close", { code: 1000, reason: "closed" });
  }

  open(): void {
    this.readyState = 1;
    this.dispatch("open", {});
  }

  private dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function lastJson(socket: FakeWebSocket): unknown {
  const last = socket.sent.at(-1);
  if (!last) throw new Error("no frame sent");
  return JSON.parse(last) as unknown;
}

describe("createPolymarketWsClient", () => {
  afterEach(() => {
    vi.useRealTimers();
    FakeWebSocket.instances = [];
  });

  it("sends the documented initial market subscription frame after open", async () => {
    const client = createPolymarketWsClient({
      logger: noopLogger,
      webSocketCtor: FakeWebSocket,
    });
    client.subscribeAsset("asset-a");
    client.subscribeAsset("asset-b");

    const socket = FakeWebSocket.instances[0];
    if (!socket) throw new Error("socket was not constructed");
    expect(socket.sent).toEqual([]);

    socket.open();

    expect(socket.sent).toHaveLength(1);
    expect(lastJson(socket)).toEqual({
      assets_ids: ["asset-a", "asset-b"],
      type: "market",
    });

    await client.close();
  });

  it("sends documented dynamic subscribe and unsubscribe update frames", async () => {
    const client = createPolymarketWsClient({
      logger: noopLogger,
      webSocketCtor: FakeWebSocket,
    });
    const socket = FakeWebSocket.instances[0];
    if (!socket) throw new Error("socket was not constructed");
    socket.open();

    client.subscribeAsset("asset-a");
    expect(lastJson(socket)).toEqual({
      assets_ids: ["asset-a"],
      operation: "subscribe",
    });

    client.unsubscribeAsset("asset-a");
    expect(lastJson(socket)).toEqual({
      assets_ids: ["asset-a"],
      operation: "unsubscribe",
    });

    await client.close();
  });

  it("sends PING on the documented 10s heartbeat cadence by default", async () => {
    vi.useFakeTimers();
    const client = createPolymarketWsClient({
      logger: noopLogger,
      webSocketCtor: FakeWebSocket,
    });
    const socket = FakeWebSocket.instances[0];
    if (!socket) throw new Error("socket was not constructed");
    socket.open();

    vi.advanceTimersByTime(9_999);
    expect(socket.sent).not.toContain("PING");

    vi.advanceTimersByTime(1);
    expect(socket.sent).toContain("PING");

    await client.close();
  });
});
