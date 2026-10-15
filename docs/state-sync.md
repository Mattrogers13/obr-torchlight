# State sync

How Torchlight keeps lights in Owlbear room metadata. The project CLAUDE.md lists the invariants; this is the detail.

## Docs

`src/hooks/useRoomState.ts` syncs two kinds of room metadata docs:

- `${ID}/state` (`RoomState`: GM `lights`, `showToPlayers`, `playersCanAdd`, `playersCanRemove`). Only GMs write it.
- `${ID}/player/<playerId>` (`PlayerDoc`: `ownerName`, at most 2 `lights`: the current one and the one last paused). Each player writes only their own; GMs can write any. Separate keys so a player's write can't clobber a GM edit (each key is last-write-wins).

## Rules

- Room metadata is writable by any client and any extension, so everything read goes through `parseRoomState` / `parsePlayerDocs` (drops malformed lights and player ids, clamps numbers). Panel, token sync and right-click all use the same parsers. Keep it that way.
- Player permissions are enforced client-side only (there's no server). A tampering client could write any key; acceptable for a game table, but don't build anything on the assumption it can't.
- Every write is prepared with `restamp`: `rev` + 1 (informational) and this writer's `writer` / `seq`. The panel's writer id is one random id per page load (module-level, survives remounts); the right-click menu uses `menu-…`. A copied doc that isn't restamped carries another client's stamp, and that client discards it as its own echo.
- Two rules keep the panel in step with the room:
  1. **Live change events.** Ignore late echoes of our own older writes (same writer, seq below our latest write to that doc). Hold off another writer's doc while one of our writes to it is in flight: events arrive in room order, so ours lands after it and replaces it, and taking it would build our next change on a state the room is about to drop. A mount that hasn't taken the shared state yet takes it regardless (nothing to protect).
  2. **After each of our writes settles** (saved or failed), read the room with `getMetadata` and take that snapshot for every doc with nothing of ours in flight. This reverts a failed write and picks up anything rule 1 held off. A snapshot is dropped and re-read if a Torchlight change event arrived while it was in flight (the event is newer). Other extensions' writes are ignored by both rules (`torchlightSignature`).
- A doc we created that isn't in the room yet is kept until it is.
- Assumption: Owlbear delivers room change events in the order the room applied them. Nothing observed so far contradicts it.
- Room metadata is capped at 16kB total across all extensions. Limits in `LIMITS` (20 GM lights, 2 per player, 40-char names) keep us small; failed writes show an error and resync.
- Burn-out alerts fire once per burn-out, player lights included, detected by the GM panel. GM lights get `alerted` in the shared state; players' lights are recorded as `burnKey`s in the shared state's `burnedOut` (`id#rearmed`, pruned and capped; `Light.rearmed` goes up whenever a burned-out light is re-armed by Reset, added time or an undone turn, so pausing or swapping a burned-out light never changes its key), so the GM never writes a player's doc just to mark a burn-out (that write could overwrite a light the player lit the same instant). The broadcast is sent once per burn-out even if recording it is retried. A light that burned out while no GM panel was open alerts when a GM next opens it.
- Players carry one light at a time (rules p.84, "extinguish all old light sources"): `replacePlayerLight` sets the current light aside (`setAside: "swap"`: paused, keeps its time, shown as "Paused") and drops anything older. Set aside isn't out: no burn-out alert, and Resume all skips it. The UI says "pause"; the code says "set aside" to keep it distinct from an ordinary GM pause.
- Same rule per token (`replaceTokenLight`, `Light.tokenId`): a right-click on a token sets aside whatever is burning on it, the GM's or a player's.
- `Light.source` is `torch` / `lantern` / `light-spell`; `SOURCES` in `lights.ts` holds label, range (30 / 60 / 30 ft) and minutes from the core rules. Old lights without a source read as torches.
- GM "Put out…" sets checked lights aside with `setAside: "put-out"` (shown "Put out", keeps its time, Resume all skips it) and sends the `light-out` broadcast. Flames are pre-checked, Light spells not (rules p.110). "Remove all" clears the shared state and every player doc.
- Use `mapLights` (not `lights.map`) for edits: it returns the original array when nothing changed, which is what makes the no-write check below work.
- `update` / `updatePlayer` / `updateLights` return a Promise<boolean> (saved or not) and skip the write when the change returns the same object. Writes apply locally at once (optimistic), so a burn-out record reads as announced on the next render. The went-out broadcast is sent once the record saves, only for burn-outs this write actually recorded (another GM may have recorded some), and not for a light re-armed before the save landed. A failed record is retried after `BURN_OUT_RETRY_MS`, never immediately (a full room would otherwise loop); one overwritten later by another writer is redone on the next change.
- Light changes go through `updateLights` (owner → change map), which writes every touched doc in ONE `setMetadata` call. GM actions across players (Remove all, Put out, Pause/Resume all, burn-out marking) must stay one write so they land all-or-nothing.
- Known limitation: two writers editing the same doc at the same instant is last-write-wins.
- GM notifications for player activity (lit / removed) come from the GM client diffing light ids against the previous render, not from a broadcast. Lights present at first load and the GM's own removals don't alert.
