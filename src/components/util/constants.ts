export const ID = "io.github.mattrogers13.torchlight";

export const paths: { [key: string]: string } = {
  about: "/about",
  playerView: "/player-view",
};

// Room metadata keys. Shared state is GM-written; each player writes only
// their own player key (see useRoomState).
export const ROOM_KEY = `${ID}/state`;
export const PLAYER_KEY_PREFIX = `${ID}/player/`;
export const playerKey = (playerId: string) => PLAYER_KEY_PREFIX + playerId;
