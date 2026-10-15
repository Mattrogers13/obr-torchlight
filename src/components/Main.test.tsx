import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, screen, fireEvent, waitFor, act } from "@testing-library/react";
import OBR from "@owlbear-rodeo/sdk";

import Main, { BURN_OUT_RETRY_MS, LIGHT_OUT_CHANNEL } from "./Main";
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
    act(() => {
      result.current.update((st) => ({ ...st, showToPlayers: true }));
    });
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
      expect(await screen.findByText("Light Sources")).toBeInTheDocument();
      await waitFor(() => expect(screen.getByPlaceholderText("Kira's torch")).toBeInTheDocument());
      fireEvent.click(screen.getByText("Light"));
      await waitFor(() => expect(mineStored()?.lights).toHaveLength(1));
      expect(mineStored()).toMatchObject({ ownerName: "Kira", lights: [{ name: "Kira's torch" }] });
      // Never touches the GM's shared state.
      expect(OBR.room.setMetadata).toHaveBeenCalledTimes(1);
      expect(vi.mocked(OBR.room.setMetadata).mock.calls[0][0]).not.toHaveProperty(ROOM_KEY);
    });

    it("a player's new light pauses their current one; the list keeps two", async () => {
      room.metadata = { [ROOM_KEY]: { playersCanAdd: true } };
      render(<Main player={true} />);
      const light = await screen.findByText("Light");
      for (let i = 0; i < 4; i++) fireEvent.click(light);
      await waitFor(() => expect(mineStored()?.lights).toHaveLength(2));
      expect(mineStored()!.lights.map((l) => !!l.setAside)).toEqual([true, false]);
      expect(screen.getByText("Paused")).toBeInTheDocument();
      expect(screen.getByText(/Lighting a new one pauses/)).toBeInTheDocument();
    });

    it("a player can remove their own light only when the GM allows it", async () => {
      room.metadata = {
        [ROOM_KEY]: { playersCanAdd: true, playersCanRemove: false },
        [playerKey("me")]: { rev: 1, ownerName: "Kira", lights: [turnTorch(0)] },
      };
      const { unmount } = render(<Main player={true} />);
      // "Lantern" is also a source option in the add form.
      expect(await screen.findByText("Lantern", { selector: "li span" })).toBeInTheDocument();
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

    it("shows players one list: their own lights plus the GM's when shared", async () => {
      room.metadata = {
        [ROOM_KEY]: {
          showToPlayers: true, playersCanAdd: true, playersCanRemove: true,
          lights: [{ ...burnedOutTorch(true), id: "gm", name: "Kira's lantern", source: "lantern", tokenId: "tok-kira" }],
        },
        [playerKey("me")]: { rev: 1, ownerName: "Kira", lights: [{ ...turnTorch(0), name: "Old torch" }] },
      };
      render(<Main player={true} />);
      expect(await screen.findByText("Kira's lantern")).toBeInTheDocument();
      expect(screen.getByText("Old torch")).toBeInTheDocument();
      expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
      expect(screen.getByLabelText("Remove Old torch")).toBeInTheDocument();
      expect(screen.queryByLabelText("Remove Kira's lantern")).not.toBeInTheDocument();
    });

    it("player hook refuses to write someone else's key", async () => {
      const { result } = renderHook(() => useRoomState({ gm: false, playerId: "me" }));
      await waitFor(() => expect(result.current.loaded).toBe(true));
      act(() => {
        result.current.updatePlayer("someone-else", (d) => ({ ...d, lights: [] }));
      });
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

  describe("player activity alerts", () => {
    const addPlayerLight = (doc: unknown) =>
      act(async () => {
        room.metadata = { ...room.metadata, [playerKey("p2")]: doc };
        room.listeners.forEach((l) => l(room.metadata));
      });

    it("puts Pause all / Resume all at the top, above Light Sources", async () => {
      room.metadata = { [ROOM_KEY]: { lights: [{ ...burnedOutTorch(false), endsAt: Date.now() + 60_000, alerted: false }] } };
      render(<Main player={false} />);
      const pause = await screen.findByText("Pause all");
      const heading = screen.getByText("Light Sources");
      expect(pause.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("tells the GM when a player lights a torch, but not for lights already burning", async () => {
      room.metadata = { [playerKey("p3")]: { rev: 1, ownerName: "Ash", lights: [{ ...turnTorch(0), id: "old" }] } };
      render(<Main player={false} />);
      expect(await screen.findByText("(Ash)")).toBeInTheDocument();
      expect(OBR.notification.show).not.toHaveBeenCalled();

      await addPlayerLight({ rev: 1, ownerName: "Bo", lights: [turnTorch(0)] });
      expect(OBR.notification.show).toHaveBeenCalledWith("Bo lit Lantern", "INFO");
    });

    it("doesn't notify players about other players' lights", async () => {
      room.metadata = { [ROOM_KEY]: { showToPlayers: true } };
      render(<Main player={true} />);
      expect(await screen.findByText("Light Sources")).toBeInTheDocument();
      await addPlayerLight({ rev: 1, ownerName: "Bo", lights: [turnTorch(0)] });
      expect(await screen.findByText("Lantern")).toBeInTheDocument();
      expect(OBR.notification.show).not.toHaveBeenCalled();
    });

    it("tells the GM when a player removes their own light", async () => {
      room.metadata = { [playerKey("p2")]: { rev: 1, ownerName: "Bo", lights: [turnTorch(0)] } };
      render(<Main player={false} />);
      expect(await screen.findByText("(Bo)")).toBeInTheDocument();
      await addPlayerLight({ rev: 2, ownerName: "Bo", lights: [] });
      expect(OBR.notification.show).toHaveBeenCalledWith("Bo removed Lantern", "INFO");
    });

    it("tells the GM when a player swaps lights, without a false 'removed'", async () => {
      const old = { ...turnTorch(0), id: "old", name: "Old torch", setAside: "swap" };
      const torch = { ...burnedOutTorch(false), id: "t1", endsAt: Date.now() + 60_000 };
      room.metadata = { [playerKey("p2")]: { rev: 1, ownerName: "Bo", lights: [old, torch] } };
      render(<Main player={false} />);
      expect(await screen.findByText("Old torch")).toBeInTheDocument();
      const lantern = { ...turnTorch(0), id: "new", name: "Bo's lantern" };
      await addPlayerLight({ rev: 2, ownerName: "Bo", lights: [{ ...torch, setAside: "swap", endsAt: null }, lantern] });
      expect(OBR.notification.show).toHaveBeenCalledWith("Bo lit Bo's lantern", "INFO");
      expect(OBR.notification.show).toHaveBeenCalledWith("Bo paused Kira's torch", "INFO");
      expect(OBR.notification.show).not.toHaveBeenCalledWith("Bo removed Old torch", "INFO");
    });

    it("Resume all doesn't relight a paused light", async () => {
      const paused = { ...burnedOutTorch(false), id: "p", name: "Paused", endsAt: null, remainingSec: 30 };
      room.metadata = {
        [ROOM_KEY]: { lights: [paused, { ...paused, id: "s", name: "Gone", setAside: "swap" }] },
      };
      render(<Main player={false} />);
      fireEvent.click(await screen.findByText("Resume all"));
      await waitFor(() => expect(stored().lights[0].endsAt).not.toBeNull());
      expect(stored().lights[1]).toMatchObject({ endsAt: null, setAside: "swap" });
    });

    it("doesn't alert the GM about their own removal of a player light", async () => {
      room.metadata = { [playerKey("p2")]: { rev: 1, ownerName: "Bo", lights: [turnTorch(0)] } };
      render(<Main player={false} />);
      fireEvent.click(await screen.findByLabelText("Remove Lantern"));
      await waitFor(() => expect(room.metadata[playerKey("p2")]).toMatchObject({ lights: [] }));
      expect(OBR.notification.show).not.toHaveBeenCalled();
    });
  });

  describe("light sources and GM bulk actions", () => {
    const burning = (id: string, name: string, source: string) => ({
      ...burnedOutTorch(false), id, name, source, endsAt: Date.now() + 600_000,
    });

    it("adds a lantern with the source picker", async () => {
      render(<Main player={false} />);
      fireEvent.change(await screen.findByLabelText("Light source"), { target: { value: "lantern" } });
      fireEvent.click(screen.getByText("Light"));
      await waitFor(() => expect(stored().lights[0]).toMatchObject({ source: "lantern" }));
    });

    it("Put out pre-checks flames, not the Light spell, and alerts everyone", async () => {
      room.metadata = {
        [ROOM_KEY]: { lights: [burning("a", "Kira's torch", "torch"), burning("b", "Ash's Light spell", "light-spell")] },
        [playerKey("p2")]: { rev: 1, ownerName: "Bo", lights: [burning("c", "Bo's lantern", "lantern")] },
      };
      render(<Main player={false} />);
      fireEvent.click(await screen.findByText("Put out…"));
      expect(screen.getByRole("checkbox", { name: /Kira's torch/ })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: /Bo's lantern/ })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: /Ash's Light spell/ })).not.toBeChecked();
      fireEvent.click(screen.getByText("Put out 2"));

      await waitFor(() => expect(stored().lights[0]).toMatchObject({ setAside: "put-out", endsAt: null }));
      expect(stored().lights[1]).toMatchObject({ setAside: null });
      expect(room.metadata[playerKey("p2")]).toMatchObject({ lights: [{ setAside: "put-out" }] });
      expect(OBR.broadcast.sendMessage).toHaveBeenCalledWith(
        LIGHT_OUT_CHANNEL, ["Kira's torch", "Bo's lantern"], { destination: "ALL" },
      );
      expect(screen.getAllByText("Put out").length).toBe(2);
    });

    it("Resume all leaves put-out lights out", async () => {
      room.metadata = { [ROOM_KEY]: { lights: [{ ...burning("a", "T", "torch"), endsAt: null, setAside: "put-out" }, { ...burning("b", "U", "torch"), endsAt: null, remainingSec: 30 }] } };
      render(<Main player={false} />);
      fireEvent.click(await screen.findByText("Resume all"));
      await waitFor(() => expect(stored().lights[1].endsAt).not.toBeNull());
      expect(stored().lights[0]).toMatchObject({ endsAt: null, setAside: "put-out" });
    });

    it("Remove all needs a second click and clears players' lights too, without alerts", async () => {
      room.metadata = {
        [ROOM_KEY]: { lights: [burning("a", "Kira's torch", "torch")] },
        [playerKey("p2")]: { rev: 1, ownerName: "Bo", lights: [burning("c", "Bo's lantern", "lantern")] },
      };
      render(<Main player={false} />);
      fireEvent.click(await screen.findByText("Remove all"));
      expect(stored().lights).toHaveLength(1);
      fireEvent.click(screen.getByText("Yes, remove all"));
      await waitFor(() => expect(stored().lights).toHaveLength(0));
      expect(room.metadata[playerKey("p2")]).toMatchObject({ lights: [] });
      expect(OBR.notification.show).not.toHaveBeenCalled();
    });
  });

  describe("pause toggle and active filter", () => {
    const running = (id: string, name: string) => ({
      ...burnedOutTorch(false), id, name, endsAt: Date.now() + 600_000,
    });

    it("one button pauses everything, then resumes it", async () => {
      room.metadata = { [ROOM_KEY]: { lights: [running("a", "Torch A")] } };
      render(<Main player={false} />);
      fireEvent.click(await screen.findByText("Pause all"));
      await waitFor(() => expect(stored().lights[0].endsAt).toBeNull());
      expect(screen.queryByText("Pause all")).not.toBeInTheDocument();
      fireEvent.click(screen.getByText("Resume all"));
      await waitFor(() => expect(stored().lights[0].endsAt).not.toBeNull());
      expect(screen.getByText("Pause all")).toBeInTheDocument();
    });

    it("Active lights only hides paused, put-out and burned-out lights, and is remembered", async () => {
      localStorage.removeItem("torchlight-active-only");
      room.metadata = {
        [ROOM_KEY]: {
          lights: [
            running("a", "Burning"),
            { ...running("b", "Swapped"), endsAt: null, setAside: "swap" },
            { ...running("c", "Blown"), endsAt: null, setAside: "put-out" },
            { ...burnedOutTorch(true), id: "d", name: "Spent" },
          ],
        },
      };
      const { unmount } = render(<Main player={false} />);
      fireEvent.click(await screen.findByLabelText("Active lights only"));
      expect(screen.getByText("Burning")).toBeInTheDocument();
      for (const gone of ["Swapped", "Blown", "Spent"]) {
        expect(screen.queryByText(gone)).not.toBeInTheDocument();
      }
      unmount();
      render(<Main player={false} />);
      expect(await screen.findByLabelText("Active lights only")).toBeChecked();
      localStorage.removeItem("torchlight-active-only");
    });
  });

  describe("multi-player GM actions are one write", () => {
    const lit = (id: string, name: string) => ({
      ...burnedOutTorch(false), id, name, endsAt: Date.now() + 600_000,
    });
    const room3 = () => ({
      [ROOM_KEY]: { lights: [lit("a", "GM torch")] },
      [playerKey("p1")]: { rev: 1, ownerName: "Ash", lights: [lit("b", "Ash's torch")] },
      [playerKey("p2")]: { rev: 1, ownerName: "Bo", lights: [lit("c", "Bo's torch")] },
    });

    it("Remove all writes the shared state and every player doc together", async () => {
      room.metadata = room3();
      render(<Main player={false} />);
      fireEvent.click(await screen.findByText("Remove all"));
      fireEvent.click(screen.getByText("Yes, remove all"));
      await waitFor(() => expect(OBR.room.setMetadata).toHaveBeenCalledTimes(1));
      expect(Object.keys(vi.mocked(OBR.room.setMetadata).mock.calls[0][0]).sort()).toEqual(
        [ROOM_KEY, playerKey("p1"), playerKey("p2")].sort(),
      );
      expect(stored().lights).toHaveLength(0);
      expect(room.metadata[playerKey("p1")]).toMatchObject({ lights: [] });
      expect(room.metadata[playerKey("p2")]).toMatchObject({ lights: [] });
    });

    it("Put out across players is one write", async () => {
      room.metadata = room3();
      render(<Main player={false} />);
      fireEvent.click(await screen.findByText("Put out…"));
      fireEvent.click(screen.getByText("Put out 3"));
      await waitFor(() => expect(OBR.room.setMetadata).toHaveBeenCalledTimes(1));
      expect(room.metadata[playerKey("p2")]).toMatchObject({ lights: [{ setAside: "put-out" }] });
    });

    it("a failed write leaves every doc as it was", async () => {
      room.metadata = room3();
      room.failWrites = true;
      render(<Main player={false} />);
      fireEvent.click(await screen.findByText("Remove all"));
      fireEvent.click(screen.getByText("Yes, remove all"));
      await waitFor(() =>
        expect(OBR.notification.show).toHaveBeenCalledWith("Torchlight couldn't save: Metadata too large", "ERROR"),
      );
      expect(await screen.findByText("Bo's torch")).toBeInTheDocument();
      expect(screen.getByText("Ash's torch")).toBeInTheDocument();
      expect(screen.getByText("GM torch")).toBeInTheDocument();
    });
  });

  describe("review fixes", () => {
    const lit = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
      ...burnedOutTorch(false), id, name, endsAt: Date.now() + 600_000, ...extra,
    });
    const pushRoom = (metadata: Record<string, unknown>) =>
      act(async () => {
        room.metadata = metadata;
        room.listeners.forEach((l) => l(room.metadata));
      });

    it("doesn't tell the GM a player paused a light when the GM's right-click did it", async () => {
      room.metadata = { [playerKey("p2")]: { rev: 1, ownerName: "Kira", lights: [lit("k", "Kira's torch")] } };
      render(<Main player={false} />);
      expect(await screen.findByText("(Kira)")).toBeInTheDocument();
      // The GM's menu set the player's light aside and lit a new one in the GM's own state.
      await pushRoom({
        [ROOM_KEY]: { rev: 1, lights: [lit("g", "Kira's lantern", { source: "lantern" })] },
        [playerKey("p2")]: { rev: 2, ownerName: "Kira", lights: [lit("k", "Kira's torch", { setAside: "swap", endsAt: null })] },
      });
      expect(OBR.notification.show).not.toHaveBeenCalledWith("Kira paused Kira's torch", "INFO");
    });

    it("retries a failed burn-out mark after a pause, not in a tight loop", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        room.metadata = { [ROOM_KEY]: { lights: [burnedOutTorch(false)] } };
        room.failWrites = true;
        render(<Main player={false} />);
        await waitFor(() =>
          expect(OBR.notification.show).toHaveBeenCalledWith("Torchlight couldn't save: Metadata too large", "ERROR"),
        );
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3000);
        });
        // Still failing, but only the one attempt so far.
        expect(OBR.room.setMetadata).toHaveBeenCalledTimes(1);
        room.failWrites = false;
        await act(async () => {
          await vi.advanceTimersByTimeAsync(BURN_OUT_RETRY_MS);
        });
        await waitFor(() => expect(stored().lights[0].alerted).toBe(true));
      } finally {
        vi.useRealTimers();
      }
    });

    it("a failed Remove all doesn't mute a later 'removed' alert", async () => {
      room.metadata = { [playerKey("p2")]: { rev: 1, ownerName: "Bo", lights: [lit("b", "Bo's torch")] } };
      room.failWrites = true;
      render(<Main player={false} />);
      fireEvent.click(await screen.findByText("Remove all"));
      fireEvent.click(screen.getByText("Yes, remove all"));
      await waitFor(() =>
        expect(OBR.notification.show).toHaveBeenCalledWith("Torchlight couldn't save: Metadata too large", "ERROR"),
      );
      expect(await screen.findByText("Bo's torch")).toBeInTheDocument();
      room.failWrites = false;
      await pushRoom({ [playerKey("p2")]: { rev: 2, ownerName: "Bo", lights: [] } });
      expect(OBR.notification.show).toHaveBeenCalledWith("Bo removed Bo's torch", "INFO");
    });

    it("a change that changes nothing writes nothing", async () => {
      const { result } = renderHook(() => useRoomState({ gm: true, playerId: "me" }));
      await waitFor(() => expect(result.current.loaded).toBe(true));
      await act(async () => {
        await result.current.update((s) => s);
        await result.current.updateLights(new Map([[null, (lights) => lights]]));
      });
      expect(OBR.room.setMetadata).not.toHaveBeenCalled();
    });
  });
});

