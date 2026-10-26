# State sync

How Torchlight keeps lights in Owlbear room metadata. The project CLAUDE.md lists the invariants; this is the detail.

## Docs

`src/hooks/useRoomState.ts` syncs two kinds of room metadata docs:

- `${ID}/state` (`RoomState`: GM `lights`, `showToPlayers`, `playersCanAdd`, `playersCanRemove`). Only GMs write it.
- `${ID}/player/<playerId>` (`PlayerDoc`: `ownerName`, at most 2 `lights`: the current one and the one last paused). Each player writes only their own; GMs can write any. Separate keys so a player's write can't clobber a GM edit (each key is last-write-wins).

## Rules

- Room metadata is writable by any client and any extension, so everything read goes through `parseRoomState` / `parsePlayerDocs` (drops malformed lights and player ids, clamps numbers). Panel, token sync and right-click all use the same parsers. Keep it that way.
- Player permissions are enforced client-side only (there's no server). A tampering client could write any key; acceptable for a game table, but don't build anything on the assumption it can't.
- Every write is prepared with `restamp`, which puts this writer's `writer` / `seq` on it and bumps `rev`. The panel's writer id is one random id per page load (module-level); the right-click menu uses `menu-…`. A copied doc that isn't restamped carries another client's stamp, and that client discards it as its own echo.
- `rev` is **compatibility only**: builds up to 2026-10-15.7 (everything live before the writer/seq change) ignore a doc whose `rev` is below the one they hold, so a player who keeps an old panel open across a deploy still accepts new writes. Nothing new reads it for staleness. **Remove after 2026-11-15** (tracked).
- Three steps keep the panel in step with the room. The authoritative description is the comment at the top of `src/hooks/useRoomState.ts`; in short:
  1. While any save of ours is in flight, room events are ignored (our saves land after anything they carry).
  2. Otherwise every event is taken, except a late echo of our own older write to that doc (our writer id, seq below the last one we sent).
  3. When the last save in flight settles, saved or failed, read the room once and take it. That reverts a failed write and picks up anything step 1 ignored. If an event was taken while the read was out, the event is newer and the read is dropped. Re-reads are one at a time (a request during one asks for one more pass), go to the panel mounted now, back off to 30 s on failure and report it once.
- Nothing trusts a seq read from the room beyond comparing it with what we sent, so a doc forged with our writer id can't corrupt the bookkeeping.
- Until the first room read lands, the panel stays on "Loading…". Unlocking with an empty state would let the GM's next edit overwrite every light in the room.
- Other extensions' writes are skipped (`torchlightSignature`), and a re-read equal to what's held keeps the held objects, so it doesn't re-render.
- Only one `useRoomState` is ever mounted (the sync state is module-level so it survives remounts).
- Assumption: Owlbear delivers room change events in the order the room applied them. Nothing observed so far contradicts it.
- Known limitation: each doc is last-write-wins as a whole. If the GM keeps a doc continuously in flight (rapid clicks) while another writer (the right-click menu, a second GM) changes it, that change is ignored by rule 1 and overwritten by the next click. Fixing it means merging per light; not worth it at this scale.
- Known limitation: two GM panels that detect the same burn-out at the same instant both record and both announce it (players see the alert twice). Avoiding it needs the GMs to coordinate; not worth it for a single-GM table.
- Room metadata is capped at 16kB total across all extensions. Limits in `LIMITS` (20 GM lights, 2 per player, 40-char names) keep us small; failed writes show an error and resync.
- Burn-out alerts fire once per burn-out, player lights included, detected by the GM panel. GM lights get `alerted` in the shared state; players' lights are recorded as `burnKey`s in the shared state's `burnedOut` (`id#rearmed`, pruned and capped; `Light.rearmed` goes up whenever a burned-out light is re-armed by Reset, added time or an undone turn, so pausing or swapping a burned-out light never changes its key), so the GM never writes a player's doc just to mark a burn-out (that write could overwrite a light the player lit the same instant). The broadcast is sent once per burn-out even if recording it is retried. A light that burned out while no GM panel was open alerts when a GM next opens it.
- Players carry one light at a time (rules p.84, "extinguish all old light sources"): `replacePlayerLight` sets the current light aside (`setAside: "swap"`: paused, keeps its time, shown as "Paused") and drops anything older. Set aside isn't out: no burn-out alert, and Resume all skips it. The UI says "pause"; the code says "set aside" to keep it distinct from an ordinary GM pause.
- Same rule per token (`replaceTokenLight`, `Light.tokenId`): a right-click on a token sets aside whatever is burning on it, the GM's or a player's.
- `Light.source` is `torch` / `lantern` / `light-spell`; `SOURCES` in `lights.ts` holds label, range (30 / 60 / 30 ft) and minutes from the core rules. Old lights without a source read as torches.
- GM "Turn out all the lights" (All / Non-magical / checklist) and the right-click "Put out light" (`putOutOnTokens`; GM: every doc, player: own doc only) set lights aside with `setAside: "put-out"` (shown "Put out", keeps its time, Resume all skips it) and sends the `light-out` broadcast. Flames are pre-checked, Light spells not (rules p.110). "Remove all" clears the shared state and every player doc.
- "Time passes" (`passTime`) takes minutes off every active real-time light, including Pause-all-paused ones (not put-out or swapped), in one write across docs.
- `unlitFt` (shared state, default 3, 0-30) is the light token sync restores on a token that had none (see token-sync.md).
- Use `mapLights` (not `lights.map`) for edits: it returns the original array when nothing changed, which is what makes the no-write check below work.
- `update` / `updatePlayer` / `updateLights` return a Promise<boolean> (saved or not) and skip the write when the change returns the same object. Writes apply locally at once (optimistic), so a burn-out record reads as announced on the next render. The went-out broadcast is sent once the record saves, only for burn-outs this write actually recorded (another GM may have recorded some), and only if it's still the same burn-out (same `burnKey`) when the save lands. A failed record is retried after `BURN_OUT_RETRY_MS`, never immediately (a full room would otherwise loop); one overwritten later by another writer is redone on the next change.
- Light changes go through `updateLights` (owner → change map), which writes every touched doc in ONE `setMetadata` call. GM actions across players (Remove all, Put out, Pause/Resume all, burn-out marking) must stay one write so they land all-or-nothing.
- Known limitation: two writers editing the same doc at the same instant is last-write-wins.
- GM notifications for player activity (lit / removed) come from the GM client diffing light ids against the previous render, not from a broadcast. Lights present at first load and the GM's own removals don't alert.
