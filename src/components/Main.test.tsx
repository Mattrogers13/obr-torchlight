import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, screen, fireEvent, waitFor, act } from "@testing-library/react";
import OBR from "@owlbear-rodeo/sdk";

import Main, { LIGHT_OUT_CHANNEL } from "./Main";
import { ROOM_KEY, playerKey, useRoomState } from "../hooks/useRoomState";
import type { Light } from "../lights";

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
    player: {
      id: "me",
      getName: vi.fn().mockResolvedValue("Kira"),
      onChange: vi.fn().mockReturnValue(() => {}),
    },
  },
}));

const stored = () => room.metadata[ROOM_KEY] as { lights: Pick<Light, "name" | "alerted" | "durationSec" | "endsAt">[] } & Record<string, unknown>;

const turnTorch = (turnsUsed: number) => ({
  id: "t2", name: "Lantern", kind: "turns", durationSec: 0, remainingSec: 0, endsAt: null,
  maxTurns: 10, turnsUsed, alerted: false,
});

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
    expect(screen.queryByText("Crawling Turns Counter")).not.toBeInTheDocument();
    expect(screen.queryByText("Random Encounter Check")).not.toBeInTheDocument();
    expect(screen.getByText("No lights burning.")).toBeInTheDocument();
  });

  it("adds a burning light with a default name and saves it to the room", async () => {
    render(<Main player={false} />);
    fireEvent.click(await screen.findByText("Light"));
    expect(await screen.findByText("Light 1")).toBeInTheDocument();
    expect(stored().lights).toHaveLength(1);
    expect(stored().lights[0]).toMatchObject({ name: "Light 1", kind: "time", durationSec: 3600 });
  });

  it("adds and removes minutes on a real-time light", async () => {
    render(<Main player={false} />);
    fireEvent.click(await screen.findByText("Light"));
    fireEvent.click(await screen.findByLabelText("Add 10 minutes on Light 1"));
    await waitFor(() => expect(stored().lights[0].durationSec).toBe(70 * 60));
    fireEvent.click(screen.getByLabelText("Remove 5 minutes on Light 1"));
    await waitFor(() => {
      const left = (stored().lights[0].endsAt! - Date.now()) / 1000;
      expect(left).toBeGreaterThan(64 * 60);
      expect(left).toBeLessThanOrEqual(65 * 60);
    });
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

  it("shows players a placeholder when lights are hidden", async () => {
    room.metadata = { [ROOM_KEY]: { lights: [burnedOutTorch(true)], showToPlayers: false } };
    render(<Main player={true} />);
    expect(await screen.findByText("Lights Hidden")).toBeInTheDocument();
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
    room.metadata = { [ROOM_KEY]: { lights: "nope", showToPlayers: "yes" } };
    render(<Main player={false} />);
    expect(await screen.findByText("No lights burning.")).toBeInTheDocument();
    expect(screen.getByTitle("Show to Players")).toBeInTheDocument();
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
    const { result } = renderHook(() => useRoomState({ gm: false, playerId: "me" }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.update((st) => ({ ...st, showToPlayers: true })));
    expect(OBR.room.setMetadata).not.toHaveBeenCalled();
    expect(result.current.state.showToPlayers).toBe(false);
  });

  it("doesn't lose rapid clicks to stale echoes of its own writes", async () => {
    room.metadata = { [ROOM_KEY]: { lights: [turnTorch(0)] } };
    render(<Main player={false} />);
    const plus = await screen.findByTitle("Burn a turn");
    room.deferEchoes = true;
    fireEvent.click(plus);
    fireEvent.click(plus);
    await flushEcho(); // late echo of the first write (turnsUsed: 1)
    fireEvent.click(plus);
    while (room.echoQueue.length) await flushEcho();
    await waitFor(() => expect(stored().lights[0]).toMatchObject({ turnsUsed: 3 }));
    expect(await screen.findByText("3 / 10")).toBeInTheDocument();
  });

  it("applies newer changes made by another GM", async () => {
    room.metadata = { [ROOM_KEY]: { rev: 4, lights: [turnTorch(2)] } };
    render(<Main player={false} />);
    expect(await screen.findByText("2 / 10")).toBeInTheDocument();
    await act(async () => {
      room.metadata = { [ROOM_KEY]: { rev: 5, lights: [turnTorch(9)] } };
      room.listeners.forEach((l) => l(room.metadata));
    });
    expect(screen.getByText("9 / 10")).toBeInTheDocument();
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

  describe("player-owned lights", () => {
    const mineStored = () =>
      room.metadata[playerKey("me")] as { ownerName: string; lights: Light[] } | undefined;

    it("GM toggles the player permissions", async () => {
      render(<Main player={false} />);
      fireEvent.click(await screen.findByLabelText(/Players can light their own/));
      fireEvent.click(screen.getByLabelText("Players can remove their own"));
      await waitFor(() =>
        expect(stored()).toMatchObject({ playersCanAdd: true, playersCanRemove: true }),
      );
    });

    it("players see the placeholder when nothing is shared or allowed", async () => {
      render(<Main player={true} />);
      expect(await screen.findByText("Lights Hidden")).toBeInTheDocument();
    });

    it("a player lights their own torch into their own key, named after them", async () => {
      room.metadata = { [ROOM_KEY]: { playersCanAdd: true } };
      render(<Main player={true} />);
      expect(await screen.findByText("Your Lights")).toBeInTheDocument();
      await waitFor(() => expect(screen.getByPlaceholderText("Kira's torch")).toBeInTheDocument());
      fireEvent.click(screen.getByText("Light"));
      await waitFor(() => expect(mineStored()?.lights).toHaveLength(1));
      expect(mineStored()).toMatchObject({ ownerName: "Kira", lights: [{ name: "Kira's torch" }] });
      // Never touches the GM's shared state.
      expect(OBR.room.setMetadata).toHaveBeenCalledTimes(1);
      expect(vi.mocked(OBR.room.setMetadata).mock.calls[0][0]).not.toHaveProperty(ROOM_KEY);
    });

    it("caps players at their light limit", async () => {
      room.metadata = { [ROOM_KEY]: { playersCanAdd: true } };
      render(<Main player={true} />);
      const light = await screen.findByText("Light");
      for (let i = 0; i < 5; i++) fireEvent.click(light);
      await waitFor(() => expect(mineStored()?.lights).toHaveLength(3));
      expect(screen.getByText("Limit of 3 lights reached.")).toBeInTheDocument();
    });

    it("a player can remove their own light only when the GM allows it", async () => {
      room.metadata = {
        [ROOM_KEY]: { playersCanAdd: true, playersCanRemove: false },
        [playerKey("me")]: { rev: 1, ownerName: "Kira", lights: [turnTorch(0)] },
      };
      const { unmount } = render(<Main player={true} />);
      expect(await screen.findByText("Lantern")).toBeInTheDocument();
      expect(screen.queryByLabelText("Remove Lantern")).not.toBeInTheDocument();
      unmount();

      room.metadata = { ...room.metadata, [ROOM_KEY]: { playersCanAdd: true, playersCanRemove: true } };
      render(<Main player={true} />);
      fireEvent.click(await screen.findByLabelText("Remove Lantern"));
      await waitFor(() => expect(mineStored()?.lights).toHaveLength(0));
    });

    it("players can't remove other players' or the GM's lights", async () => {
      room.metadata = {
        [ROOM_KEY]: { showToPlayers: true, playersCanRemove: true, lights: [burnedOutTorch(true)] },
        [playerKey("someone-else")]: { rev: 1, ownerName: "Bo", lights: [turnTorch(0)] },
      };
      render(<Main player={true} />);
      expect(await screen.findByText("Lantern")).toBeInTheDocument();
      expect(screen.getByText("Kira's torch")).toBeInTheDocument();
      expect(screen.queryByLabelText(/^Remove/)).not.toBeInTheDocument();
    });

    it("player hook refuses to write someone else's key", async () => {
      const { result } = renderHook(() => useRoomState({ gm: false, playerId: "me" }));
      await waitFor(() => expect(result.current.loaded).toBe(true));
      act(() => result.current.updatePlayer("someone-else", (d) => ({ ...d, lights: [] })));
      expect(OBR.room.setMetadata).not.toHaveBeenCalled();
    });

    it("GM sees player lights with the owner's name and can manage them", async () => {
      room.metadata = { [playerKey("p2")]: { rev: 3, ownerName: "Bo", lights: [turnTorch(0)] } };
      render(<Main player={false} />);
      expect(await screen.findByText("(Bo)")).toBeInTheDocument();
      fireEvent.click(screen.getByTitle("Burn a turn"));
      await waitFor(() =>
        expect(room.metadata[playerKey("p2")]).toMatchObject({ rev: 4, lights: [{ turnsUsed: 1 }] }),
      );
      fireEvent.click(screen.getByLabelText("Remove Lantern"));
      await waitFor(() => expect(room.metadata[playerKey("p2")]).toMatchObject({ lights: [] }));
    });

    it("GM alerts once for a player's light that burned out", async () => {
      room.metadata = {
        [playerKey("p2")]: { rev: 1, ownerName: "Bo", lights: [burnedOutTorch(false)] },
      };
      render(<Main player={false} />);
      await waitFor(() =>
        expect(room.metadata[playerKey("p2")]).toMatchObject({ lights: [{ alerted: true }] }),
      );
      expect(OBR.broadcast.sendMessage).toHaveBeenCalledTimes(1);
      expect(room.metadata[ROOM_KEY]).toBeUndefined();
    });
  });
});
