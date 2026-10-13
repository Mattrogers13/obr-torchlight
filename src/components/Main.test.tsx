import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, screen, fireEvent, waitFor, act } from "@testing-library/react";
import OBR from "@owlbear-rodeo/sdk";

import Main, { LIGHT_OUT_CHANNEL } from "./Main";
import { ROOM_KEY, useRoomState } from "../hooks/useRoomState";

// In-memory stand-in for OBR room metadata and broadcasts.
const room = vi.hoisted(() => ({
  metadata: {} as Record<string, unknown>,
  listeners: [] as ((m: Record<string, unknown>) => void)[],
  failWrites: false,
  // When set, change events queue up until flushed, like real network echoes.
  deferEchoes: false,
  echoQueue: [] as Record<string, unknown>[],
}));

const flushEcho = () =>
  act(async () => {
    const snapshot = room.echoQueue.shift();
    if (snapshot) room.listeners.forEach((l) => l(snapshot));
  });

vi.mock("@owlbear-rodeo/sdk", () => ({
  default: {
    room: {
      getMetadata: vi.fn(async () => room.metadata),
      setMetadata: vi.fn(async (update: Record<string, unknown>) => {
        if (room.failWrites) throw new Error("Metadata too large");
        room.metadata = { ...room.metadata, ...update };
        if (room.deferEchoes) room.echoQueue.push(room.metadata);
        else room.listeners.forEach((l) => l(room.metadata));
      }),
      onMetadataChange: vi.fn((cb: (m: Record<string, unknown>) => void) => {
        room.listeners.push(cb);
        return () => {
          room.listeners = room.listeners.filter((l) => l !== cb);
        };
      }),
    },
    broadcast: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onMessage: vi.fn().mockReturnValue(() => {}),
    },
    notification: { show: vi.fn().mockResolvedValue("notification-id") },
  },
}));

const stored = () => room.metadata[ROOM_KEY] as { lights: { name: string; alerted: boolean }[] } & Record<string, unknown>;

const burnedOutTorch = (alerted: boolean) => ({
  id: "t1", name: "Kira's torch", kind: "time",
  durationSec: 60, remainingSec: 60, endsAt: Date.now() - 1000,
  maxTurns: 10, turnsUsed: 0, alerted,
});

describe("Main (Torchlight)", () => {
  beforeEach(() => {
    room.metadata = {};
    room.listeners = [];
    room.failWrites = false;
    room.deferEchoes = false;
    room.echoQueue = [];
    vi.clearAllMocks();
  });

  it("renders the GM tools", async () => {
    render(<Main player={false} />);
    expect(await screen.findByText("Light Sources")).toBeInTheDocument();
    expect(screen.getByText("Crawling Turns Counter")).toBeInTheDocument();
    expect(screen.getByText("No lights burning.")).toBeInTheDocument();
  });

  it("adds a burning light with a default name and saves it to the room", async () => {
    render(<Main player={false} />);
    fireEvent.click(await screen.findByText("Light"));
    expect(await screen.findByText("Light 1")).toBeInTheDocument();
    expect(stored().lights).toHaveLength(1);
    expect(stored().lights[0]).toMatchObject({ name: "Light 1", kind: "time", durationSec: 3600 });
  });

  it("adds a named turn light with a custom count", async () => {
    render(<Main player={false} />);
    fireEvent.change(await screen.findByLabelText("Light name"), { target: { value: "Lantern" } });
    fireEvent.change(screen.getByLabelText("Light type"), { target: { value: "turns" } });
    fireEvent.change(screen.getByLabelText("Turns"), { target: { value: "6" } });
    fireEvent.click(screen.getByText("Light"));
    expect(await screen.findByText("0 / 6")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Burn a turn"));
    expect(await screen.findByText("1 / 6")).toBeInTheDocument();
  });

  it("blocks adding with an invalid amount", async () => {
    render(<Main player={false} />);
    fireEvent.change(await screen.findByLabelText("Minutes"), { target: { value: "0" } });
    expect(screen.getByText("Light")).toBeDisabled();
  });

  it("increments the crawling turns counter in room state", async () => {
    render(<Main player={false} />);
    fireEvent.click(await screen.findByText("+"));
    expect(await screen.findByText("01")).toBeInTheDocument();
    expect(stored().crawlTurns).toBe(1);
  });

  it("alerts once for a light that burned out while the panel was closed", async () => {
    room.metadata = { [ROOM_KEY]: { lights: [burnedOutTorch(false)] } };
    render(<Main player={false} />);
    await waitFor(() => expect(stored().lights[0].alerted).toBe(true));
    expect(OBR.broadcast.sendMessage).toHaveBeenCalledTimes(1);
    expect(OBR.broadcast.sendMessage).toHaveBeenCalledWith(
      LIGHT_OUT_CHANNEL, ["Kira's torch"], { destination: "ALL" },
    );
  });

  it("doesn't re-alert a light that was already announced", async () => {
    room.metadata = { [ROOM_KEY]: { lights: [burnedOutTorch(true)] } };
    render(<Main player={false} />);
    expect(await screen.findByText("Kira's torch")).toBeInTheDocument();
    expect(OBR.broadcast.sendMessage).not.toHaveBeenCalled();
  });

  it("shows players the gif when lights are hidden", async () => {
    room.metadata = { [ROOM_KEY]: { lights: [burnedOutTorch(true)], showToPlayers: false } };
    render(<Main player={true} />);
    expect(await screen.findByText("Nothing to See Here")).toBeInTheDocument();
  });

  it("shows players a read-only list and never writes or alerts", async () => {
    room.metadata = { [ROOM_KEY]: { lights: [burnedOutTorch(false)], showToPlayers: true } };
    render(<Main player={true} />);
    expect(await screen.findByText("Kira's torch")).toBeInTheDocument();
    expect(screen.queryByText("Pause all")).not.toBeInTheDocument();
    expect(OBR.room.setMetadata).not.toHaveBeenCalled();
    expect(OBR.broadcast.sendMessage).not.toHaveBeenCalled();
  });

  it("survives malformed room metadata", async () => {
    room.metadata = { [ROOM_KEY]: { lights: "nope", crawlTurns: "lots" } };
    render(<Main player={false} />);
    expect(await screen.findByText("No lights burning.")).toBeInTheDocument();
    expect(screen.getByText("00")).toBeInTheDocument();
  });

  it("tells the GM when a save fails", async () => {
    room.failWrites = true;
    render(<Main player={false} />);
    fireEvent.click(await screen.findByText("Light"));
    await waitFor(() =>
      expect(OBR.notification.show).toHaveBeenCalledWith(
        "Torchlight couldn't save: Metadata too large", "ERROR",
      ),
    );
    // Falls back to what the room actually holds.
    expect(await screen.findByText("No lights burning.")).toBeInTheDocument();
  });

  it("tells the user when room state can't be loaded", async () => {
    vi.mocked(OBR.room.getMetadata).mockRejectedValueOnce(new Error("offline"));
    render(<Main player={false} />);
    await act(async () => {});
    expect(OBR.notification.show).toHaveBeenCalledWith(
      "Torchlight couldn't load room state: offline", "ERROR",
    );
  });

  it("refuses writes from a read-only (player) client", async () => {
    const { result } = renderHook(() => useRoomState(false));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.update((st) => ({ ...st, crawlTurns: 99 })));
    expect(OBR.room.setMetadata).not.toHaveBeenCalled();
    expect(result.current.state.crawlTurns).toBe(0);
  });

  it("doesn't lose rapid clicks to stale echoes of its own writes", async () => {
    render(<Main player={false} />);
    const plus = await screen.findByText("+");
    room.deferEchoes = true;
    fireEvent.click(plus);
    fireEvent.click(plus);
    await flushEcho(); // late echo of the first write (crawlTurns: 1)
    fireEvent.click(plus);
    while (room.echoQueue.length) await flushEcho();
    await waitFor(() => expect(stored().crawlTurns).toBe(3));
    expect(await screen.findByText("03")).toBeInTheDocument();
  });

  it("applies newer changes made by another GM", async () => {
    room.metadata = { [ROOM_KEY]: { rev: 4, crawlTurns: 2 } };
    render(<Main player={false} />);
    expect(await screen.findByText("02")).toBeInTheDocument();
    await act(async () => {
      room.metadata = { [ROOM_KEY]: { rev: 5, crawlTurns: 9 } };
      room.listeners.forEach((l) => l(room.metadata));
    });
    expect(screen.getByText("09")).toBeInTheDocument();
  });

  it("still alerts the GM when the burn-out broadcast fails", async () => {
    vi.mocked(OBR.broadcast.sendMessage).mockRejectedValueOnce(new Error("rate limited"));
    room.metadata = { [ROOM_KEY]: { lights: [burnedOutTorch(false)] } };
    render(<Main player={false} />);
    await waitFor(() =>
      expect(OBR.notification.show).toHaveBeenCalledWith(
        "Kira's torch went out! (Couldn't alert players: rate limited)", "WARNING",
      ),
    );
  });

  it("logs instead of crashing when a notification itself fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(OBR.notification.show).mockRejectedValueOnce(new Error("no UI"));
    room.failWrites = true;
    render(<Main player={false} />);
    fireEvent.click(await screen.findByText("Light"));
    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        "Torchlight notification failed: no UI", "Torchlight couldn't save: Metadata too large",
      ),
    );
    consoleError.mockRestore();
  });
});
