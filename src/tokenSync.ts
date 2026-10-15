import OBR, { Image, Item, buildImage } from "@owlbear-rodeo/sdk";

import { ID, PLAYER_KEY_PREFIX, ROOM_KEY } from "./constants";
import {
  Light,
  LightSource,
  SOURCES,
  isActive,
  isRunning,
  parsePlayerDocs,
  parseRoomState,
} from "./lights";
import { errorMessage } from "./utils";

// Keeps tokens' Dynamic Fog lights in step with Torchlight's timers: a token
// with a burning light gets that source's light and a small badge; when the
// light stops (burns out, is put out, or is swapped for a new one) the
// token's previous light comes back. A Pause all for a table break leaves
// the token lit. Runs from the GM's background page.

// Dynamic Fog stores a token's light here (github.com/owlbear-rodeo/dynamic-fog).
export const DF_LIGHT_KEY = "rodeo.owlbear.dynamic-fog/light";
// On a token we lit: the light it had before (null = none) and our source.
export const TOKEN_KEY = `${ID}/token`;
// On our badge items, so we can find them again.
export const BADGE_KEY = `${ID}/badge`;

export interface DfLight {
  attenuationRadius: number;
  sourceRadius: number;
  falloff: number;
  innerAngle: number;
  outerAngle: number;
  lightType: "PRIMARY" | "SECONDARY";
}

// Full circle, primary, solid edge. sourceRadius matches what Dynamic Fog
// uses for "Add Light", small enough to fit through a 5 ft door.
export const dfLight = (rangePx: number): DfLight => ({
  attenuationRadius: rangePx,
  sourceRadius: 25,
  falloff: 0.2,
  innerAngle: 360,
  outerAngle: 360,
  lightType: "PRIMARY",
});

// Feet to scene pixels. Shadowdark maps are 5 ft squares; a grid whose unit
// isn't feet is treated as 5 ft per cell.
export const rangePx = (rangeFt: number, dpi: number, unit: string, multiplier: number) =>
  (rangeFt / (unit === "ft" && multiplier > 0 ? multiplier : 5)) * dpi;

// A light and whose doc it came from (null = the GM's shared state).
export interface OwnedLight {
  light: Light;
  ownerId: string | null;
}

// Player docs are written by players and can be forged, so a player's light
// only reaches a token that player could edit anyway, by Owlbear's own room
// permissions, and never a hidden one (that would reveal it through the fog).
export const playerMayLight = (
  token: { visible: boolean; createdUserId: string } | undefined,
  ownerId: string,
  roomPermissions: string[],
) =>
  !!token &&
  token.visible &&
  roomPermissions.includes("CHARACTER_UPDATE") &&
  (!roomPermissions.includes("CHARACTER_OWNER_ONLY") || token.createdUserId === ownerId);

// Which source each token should show: any active light linked to it that
// its owner may place there. If two ever overlap, the longer range wins.
export const desiredSources = (
  owned: OwnedLight[],
  now: number,
  mayLight: (tokenId: string, ownerId: string | null) => boolean = () => true,
) => {
  const want = new Map<string, LightSource>();
  for (const { light, ownerId } of owned) {
    if (!light.tokenId || !isActive(light, now) || !mayLight(light.tokenId, ownerId)) continue;
    const current = want.get(light.tokenId);
    if (!current || SOURCES[light.source].rangeFt > SOURCES[current].rangeFt) {
      want.set(light.tokenId, light.source);
    }
  }
  return want;
};

export interface TokenMarker {
  saved: unknown; // the token's Dynamic Fog light before we lit it; null = none
  source: LightSource;
}

export interface TokenState {
  id: string;
  dfLight: unknown;
  marker: TokenMarker | undefined;
}

export interface BadgeState {
  id: string;
  attachedTo: string | undefined;
  source: LightSource | undefined;
  image: string | undefined;
}

// PNG, not SVG: Chrome can't decode SVG into the canvas textures Owlbear
// draws items with (createImageBitmap fails), so an SVG badge showed as a
// black square there. Sources: art/badges/*.svg.
export const badgeImage = (origin: string, source: LightSource) => `${origin}/img/badge-${source}.png`;

export interface SyncPlan {
  apply: { tokenId: string; source: LightSource; saved: unknown }[];
  restore: { tokenId: string; saved: unknown }[];
  addBadges: { tokenId: string; source: LightSource }[];
  deleteBadges: string[];
}

const sameLight = (a: unknown, b: DfLight) =>
  typeof a === "object" &&
  a !== null &&
  (Object.keys(b) as (keyof DfLight)[]).every((k) => (a as Record<string, unknown>)[k] === b[k]);

// Pure: what to change so the scene matches `desired`.
export const planSync = (
  desired: Map<string, LightSource>,
  tokens: TokenState[],
  badges: BadgeState[],
  pxFor: (source: LightSource) => number,
  imageFor: (source: LightSource) => string = () => "",
): SyncPlan => {
  const plan: SyncPlan = { apply: [], restore: [], addBadges: [], deleteBadges: [] };
  const present = new Set(tokens.map((t) => t.id));

  for (const token of tokens) {
    const want = desired.get(token.id);
    if (want) {
      const target = dfLight(pxFor(want));
      if (!token.marker) {
        plan.apply.push({ tokenId: token.id, source: want, saved: token.dfLight ?? null });
      } else if (token.marker.source !== want || !sameLight(token.dfLight, target)) {
        plan.apply.push({ tokenId: token.id, source: want, saved: token.marker.saved });
      }
    } else if (token.marker) {
      plan.restore.push({ tokenId: token.id, saved: token.marker.saved });
    }
  }

  // One badge per lit token, showing its source with the current image.
  // Anything else goes (including badges with an outdated image).
  const kept = new Set<string>();
  for (const badge of badges) {
    const want = badge.attachedTo ? desired.get(badge.attachedTo) : undefined;
    if (
      want &&
      badge.source === want &&
      badge.image === imageFor(want) &&
      !kept.has(badge.attachedTo!) &&
      present.has(badge.attachedTo!)
    ) {
      kept.add(badge.attachedTo!);
    } else {
      plan.deleteBadges.push(badge.id);
    }
  }
  for (const [tokenId, source] of desired) {
    if (present.has(tokenId) && !kept.has(tokenId)) plan.addBadges.push({ tokenId, source });
  }
  return plan;
};

// Token metadata is editable by anyone who can edit the token, so only the
// known Dynamic Fog fields survive a save/restore round trip.
const DF_NUMBERS = ["attenuationRadius", "sourceRadius", "falloff", "innerAngle", "outerAngle", "rotation"];
export const parseDfLight = (v: unknown): Record<string, unknown> | null => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const raw = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of DF_NUMBERS) {
    if (typeof raw[key] === "number" && Number.isFinite(raw[key])) out[key] = raw[key];
  }
  if (raw.lightType === "PRIMARY" || raw.lightType === "SECONDARY") out.lightType = raw.lightType;
  return Object.keys(out).length > 0 ? out : null;
};

const parseMarker = (v: unknown): TokenMarker | undefined => {
  if (typeof v !== "object" || v === null) return undefined;
  const { saved, source } = v as Record<string, unknown>;
  return typeof source === "string" && source in SOURCES
    ? { saved: parseDfLight(saved), source: source as LightSource }
    : undefined;
};

const allLights = (metadata: Record<string, unknown>): OwnedLight[] => {
  const owned: OwnedLight[] = parseRoomState(metadata[ROOM_KEY]).lights.map((light) => ({ light, ownerId: null }));
  for (const [ownerId, doc] of Object.entries(parsePlayerDocs(metadata))) {
    owned.push(...doc.lights.map((light) => ({ light, ownerId })));
  }
  return owned;
};

const badge = (token: Item, source: LightSource, dpi: number): Image => {
  // About a third of a grid cell, at the token's top-right.
  const size = 128;
  const offset = (dpi / 2) * Math.max(token.scale.x, 0.5) * 0.75;
  return buildImage(
    { width: size, height: size, mime: "image/png", url: badgeImage(window.location.origin, source) },
    { dpi: size / 0.35, offset: { x: size / 2, y: size / 2 } },
  )
    .name(`${SOURCES[source].label} (Torchlight)`)
    .position({ x: token.position.x + offset, y: token.position.y - offset })
    .attachedTo(token.id)
    .layer("ATTACHMENT")
    .locked(true)
    .disableHit(true)
    .disableAttachmentBehavior(["ROTATION", "COPY"])
    .metadata({ [BADGE_KEY]: { source } })
    .build();
};

export const syncOnce = async () => {
  // Two rounds of SDK calls (each a postMessage round trip), not eight in a
  // row: the checks and metadata together, then everything that needs them.
  const [role, ready, metadata] = await Promise.all([
    OBR.player.getRole(),
    OBR.scene.isReady(),
    OBR.room.getMetadata(),
  ]);
  if (role !== "GM" || !ready) return;

  const now = Date.now();
  const owned = allLights(metadata);
  const linked = new Set(owned.map((o) => o.light.tokenId).filter((id): id is string => !!id));

  // One pass over the scene for both linked tokens and our badges.
  const [items, permissions, dpi, scale] = await Promise.all([
    OBR.scene.items.getItems(
      (item) =>
        item.metadata[BADGE_KEY] !== undefined ||
        (item.layer === "CHARACTER" && (linked.has(item.id) || item.metadata[TOKEN_KEY] !== undefined)),
    ),
    OBR.room.getPermissions(),
    OBR.scene.grid.getDpi(),
    OBR.scene.grid.getScale(),
  ]);
  const badges = items.filter((item) => item.metadata[BADGE_KEY] !== undefined);
  const tokens = items.filter((item) => item.metadata[BADGE_KEY] === undefined);
  const tokensById = new Map(tokens.map((t) => [t.id, t]));
  const desired = desiredSources(
    owned,
    now,
    (tokenId, ownerId) => ownerId === null || playerMayLight(tokensById.get(tokenId), ownerId, permissions),
  );
  const pxFor = (source: LightSource) =>
    rangePx(SOURCES[source].rangeFt, dpi, scale.parsed.unit, scale.parsed.multiplier);

  const plan = planSync(
    desired,
    tokens.map((t) => ({
      id: t.id,
      dfLight: parseDfLight(t.metadata[DF_LIGHT_KEY]),
      marker: parseMarker(t.metadata[TOKEN_KEY]),
    })),
    badges.map((b) => {
      const source = (b.metadata[BADGE_KEY] as { source?: unknown } | undefined)?.source;
      return {
        id: b.id,
        attachedTo: b.attachedTo,
        source: typeof source === "string" && source in SOURCES ? (source as LightSource) : undefined,
        image: b.type === "IMAGE" ? (b as Image).image.url : undefined,
      };
    }),
    pxFor,
    (source) => badgeImage(window.location.origin, source),
  );

  const apply = new Map(plan.apply.map((a) => [a.tokenId, a]));
  const restore = new Map(plan.restore.map((r) => [r.tokenId, r]));
  if (apply.size + restore.size > 0) {
    await OBR.scene.items.updateItems([...apply.keys(), ...restore.keys()], (drafts) => {
      for (const draft of drafts) {
        const a = apply.get(draft.id);
        if (a) {
          draft.metadata[DF_LIGHT_KEY] = dfLight(pxFor(a.source));
          draft.metadata[TOKEN_KEY] = { saved: a.saved, source: a.source };
          continue;
        }
        const r = restore.get(draft.id);
        if (!r) continue;
        if (r.saved === null || r.saved === undefined) delete draft.metadata[DF_LIGHT_KEY];
        else draft.metadata[DF_LIGHT_KEY] = r.saved;
        delete draft.metadata[TOKEN_KEY];
      }
    });
  }
  if (plan.deleteBadges.length > 0) await OBR.scene.items.deleteItems(plan.deleteBadges);
  if (plan.addBadges.length > 0) {
    await OBR.scene.items.addItems(
      plan.addBadges.map(({ tokenId, source }) => badge(tokensById.get(tokenId)!, source, dpi)),
    );
  }

  return owned.map((o) => o.light);
};

// Torchlight's slice of room metadata, to tell our changes from other
// extensions' (room metadata is shared by every extension in the room).
export const torchlightSignature = (metadata: Record<string, unknown>) =>
  JSON.stringify(
    Object.keys(metadata)
      .filter((key) => key === ROOM_KEY || key.startsWith(PLAYER_KEY_PREFIX))
      .sort()
      .map((key) => [key, metadata[key]]),
  );

// Reconciles now, on every room change and scene load, and again right when
// the next linked timer runs out, so tokens go dark on time with no panel open.
export const startTokenSync = () => {
  let busy = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (lights: Light[] | undefined) => {
    clearTimeout(timer);
    const now = Date.now();
    const next = (lights ?? [])
      .filter((l) => l.tokenId && isRunning(l) && l.endsAt! > now)
      .reduce((min, l) => Math.min(min, l.endsAt!), Infinity);
    if (next !== Infinity) timer = setTimeout(run, next - now + 250);
  };

  const run = async () => {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    let lights: Light[] | undefined;
    try {
      do {
        again = false;
        lights = await syncOnce();
      } while (again);
    } catch (err) {
      console.error(`Torchlight token sync failed: ${errorMessage(err)}`);
    } finally {
      busy = false;
      schedule(lights);
    }
  };

  run();
  // Room metadata is shared by every extension; only rerun when Torchlight's
  // own keys changed.
  let lastSeen = "";
  OBR.room.onMetadataChange((metadata) => {
    const ours = torchlightSignature(metadata);
    if (ours === lastSeen) return;
    lastSeen = ours;
    run();
  });
  OBR.scene.onReadyChange((ready) => ready && run());
  // Player changes fire on every selection; only a role change matters.
  let role: string | undefined;
  OBR.player.onChange((player) => {
    if (player.role !== role) {
      role = player.role;
      run();
    }
  });
};
