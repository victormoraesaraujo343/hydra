import type {
  PortCovers,
  PortCoversCacheEntry,
} from "../../../types/ports.types.js";

export const STEAMGRIDDB_API = "https://www.steamgriddb.com/api/v2";
export const COVERS_MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const DROPPED_WORDS = new Set([
  "recomp",
  "recompiled",
  "recompilation",
  "decomp",
  "decompilation",
  "port",
  "pc",
  "native",
  "remake",
  "project",
]);

export interface PortCoversDeps {
  /** Resolves with the parsed JSON body. Rejects with CoversHttpError on non-2xx. */
  fetchJson: (url: string) => Promise<unknown>;
}

/** An HTTP failure from fetchJson. Only the status is kept, never headers. */
export class CoversHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`SteamGridDB responded with HTTP ${status}`);
    this.name = "CoversHttpError";
    this.status = status;
  }
}

/** The key was rejected (401/403). */
export class CoversInvalidKeyError extends Error {
  readonly code = "invalid_key" as const;

  constructor() {
    super("invalid_key");
    this.name = "CoversInvalidKeyError";
  }
}

/** Removes parenthetical parts and recomp/port-style words from a title. */
export const cleanTitleForSearch = (title: string): string => {
  let withoutParens = title;
  let previous: string;

  do {
    previous = withoutParens;
    withoutParens = withoutParens.replace(/\([^()]*\)/g, " ");
  } while (withoutParens !== previous);

  return withoutParens
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .filter((word) => {
      const bare = word.toLowerCase().replace(/[^a-z0-9]/g, "");
      return !DROPPED_WORDS.has(bare);
    })
    .join(" ")
    .trim();
};

const isAuthFailure = (error: unknown): boolean =>
  error instanceof CoversHttpError &&
  (error.status === 401 || error.status === 403);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readDataList = (json: unknown): Record<string, unknown>[] => {
  if (!isRecord(json) || !Array.isArray(json.data)) return [];
  return json.data.filter(isRecord);
};

const readFirstGameId = (json: unknown): string | null => {
  const first = readDataList(json)[0];
  if (!first) return null;

  if (typeof first.id === "number" || typeof first.id === "string") {
    return String(first.id);
  }

  return null;
};

const readFirstUrl = (json: unknown): string | null => {
  const first = readDataList(json)[0];
  return typeof first?.url === "string" && first.url.length > 0
    ? first.url
    : null;
};

/**
 * Runs one SteamGridDB call. Auth failures become CoversInvalidKeyError;
 * every other failure resolves to null so the caller can keep going.
 */
const attempt = async (
  task: () => Promise<string | null>
): Promise<string | null> => {
  try {
    return await task();
  } catch (error) {
    if (isAuthFailure(error)) throw new CoversInvalidKeyError();
    return null;
  }
};

/**
 * Looks up cover (grid, 600x900) and hero art for a port on SteamGridDB.
 * Throws CoversInvalidKeyError when the key is rejected. Other failures
 * give null for the part that failed.
 */
export const resolvePortCovers = async (
  port: { title: string },
  deps: PortCoversDeps
): Promise<PortCovers> => {
  const query = cleanTitleForSearch(port.title);
  if (!query) return { cover: null, hero: null };

  const gameId = await attempt(async () =>
    readFirstGameId(
      await deps.fetchJson(
        `${STEAMGRIDDB_API}/search/autocomplete/${encodeURIComponent(query)}`
      )
    )
  );

  if (!gameId) return { cover: null, hero: null };

  const [cover, hero] = await Promise.all([
    attempt(async () =>
      readFirstUrl(
        await deps.fetchJson(
          `${STEAMGRIDDB_API}/grids/game/${gameId}?dimensions=600x900&types=static`
        )
      )
    ),
    attempt(async () =>
      readFirstUrl(
        await deps.fetchJson(`${STEAMGRIDDB_API}/heroes/game/${gameId}`)
      )
    ),
  ]);

  return { cover, hero };
};

export const hasCovers = (covers: PortCovers): boolean =>
  covers.cover !== null || covers.hero !== null;

/**
 * A cached hit is reused forever. A cached miss is reused for
 * COVERS_MISS_TTL_MS after it was checked.
 */
export const isCoversCacheEntryUsable = (
  entry: PortCoversCacheEntry,
  nowMs: number
): boolean => {
  if (hasCovers(entry)) return true;

  const checkedAt = Date.parse(entry.checkedAt);
  return Number.isFinite(checkedAt) && nowMs - checkedAt < COVERS_MISS_TTL_MS;
};
