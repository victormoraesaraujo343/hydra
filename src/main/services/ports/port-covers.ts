import axios from "axios";

import { db, levelKeys, portsCoversCacheSublevel } from "@main/level";
import type {
  PortCatalogueEntry,
  PortCovers,
  PortResult,
  UserPreferences,
} from "@types";

import { logger } from "../logger";
import {
  CoversHttpError,
  CoversInvalidKeyError,
  hasCovers,
  isCoversCacheEntryUsable,
  resolvePortCovers,
} from "./port-covers-core";
import { findPort } from "./ports-catalogue";

const COVERS_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT_COVER_LOOKUPS = 3;

/** Lookups in flight, by port id, so a port is only looked up once at a time. */
const inFlight = new Map<string, Promise<PortResult<PortCovers>>>();

/** Lookups waiting for a free slot. */
const waitingLookups: Array<() => void> = [];
let activeLookups = 0;

/** The last key SteamGridDB rejected. Lookups with it fail fast, with no request. */
let rejectedKey: string | null = null;

const acquireLookupSlot = (): Promise<void> => {
  if (activeLookups < MAX_CONCURRENT_COVER_LOOKUPS) {
    activeLookups++;
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => waitingLookups.push(resolve));
};

const releaseLookupSlot = () => {
  const next = waitingLookups.shift();

  // Hand the slot straight to the next waiter.
  if (next) next();
  else activeLookups--;
};

const readSteamGridDbKey = async (): Promise<string> => {
  try {
    const preferences = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      { valueEncoding: "json" }
    );
    const key = preferences?.steamGridDbApiKey;
    return typeof key === "string" ? key.trim() : "";
  } catch {
    return "";
  }
};

const readCache = async (portId: string) => {
  try {
    return (await portsCoversCacheSublevel.get(portId)) ?? null;
  } catch {
    return null;
  }
};

const writeCache = async (portId: string, covers: PortCovers) => {
  try {
    await portsCoversCacheSublevel.put(portId, {
      ...covers,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.warn("Failed to write ports covers cache", error);
  }
};

/**
 * Removes cached misses so they are looked up again. Cached hits stay.
 * Called when the SteamGridDB key changes.
 */
export const clearPortCoverMisses = async (): Promise<void> => {
  try {
    const batch = portsCoversCacheSublevel.batch();
    let hasOperations = false;

    for await (const [portId, entry] of portsCoversCacheSublevel.iterator()) {
      if (!hasCovers(entry)) {
        batch.del(portId);
        hasOperations = true;
      }
    }

    if (hasOperations) await batch.write();
  } catch (error) {
    logger.warn("Failed to clear ports covers misses", error);
  }
};

/**
 * fetchJson for the core. The key only goes in the Authorization header,
 * and errors keep the status only, never the request headers.
 */
const createFetchJson =
  (apiKey: string, onTransientFailure: () => void) =>
  async (url: string): Promise<unknown> => {
    try {
      const { data } = await axios.get<unknown>(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "User-Agent": "HydraLauncher",
        },
        timeout: COVERS_TIMEOUT_MS,
      });

      return data;
    } catch (error) {
      const status = axios.isAxiosError(error)
        ? (error.response?.status ?? 0)
        : 0;

      // A 404 or a rejected key is a real answer. Anything else may pass later.
      if (status !== 401 && status !== 403 && status !== 404) {
        onTransientFailure();
      }

      throw new CoversHttpError(status);
    }
  };

const lookupCovers = async (
  port: PortCatalogueEntry,
  apiKey: string
): Promise<PortResult<PortCovers>> => {
  let transientFailure = false;
  const fetchJson = createFetchJson(apiKey, () => {
    transientFailure = true;
  });

  await acquireLookupSlot();

  try {
    const covers = await resolvePortCovers(
      { title: port.title },
      { fetchJson }
    );

    // Do not cache a result that may have failed on the network.
    if (!transientFailure) await writeCache(port.id, covers);

    return { ok: true, data: covers };
  } catch (error) {
    if (error instanceof CoversInvalidKeyError) {
      rejectedKey = apiKey;
      logger.warn(`SteamGridDB rejected the covers key (port ${port.id})`);
      return { ok: false, error: "invalid_covers_key" };
    }

    logger.warn(`Covers lookup failed for port ${port.id}`);
    return { ok: true, data: { cover: null, hero: null } };
  } finally {
    releaseLookupSlot();
  }
};

const loadPortCover = async (
  portId: string
): Promise<PortResult<PortCovers>> => {
  const apiKey = await readSteamGridDbKey();
  if (!apiKey) return { ok: false, error: "no_covers_key" };

  const port = await findPort(portId);
  if (!port) return { ok: false, error: "port_not_found" };

  if (port.coverImageUrl || port.heroImageUrl) {
    return {
      ok: true,
      data: { cover: port.coverImageUrl, hero: port.heroImageUrl },
    };
  }

  if (apiKey === rejectedKey) {
    return { ok: false, error: "invalid_covers_key" };
  }

  const cached = await readCache(portId);
  if (cached && isCoversCacheEntryUsable(cached, Date.now())) {
    return { ok: true, data: { cover: cached.cover, hero: cached.hero } };
  }

  return lookupCovers(port, apiKey);
};

/**
 * Cover and hero art for a port. Uses the catalogue images when present,
 * otherwise SteamGridDB with the user's key.
 */
export const getPortCover = (
  portId: string
): Promise<PortResult<PortCovers>> => {
  const pending = inFlight.get(portId);
  if (pending) return pending;

  const request = loadPortCover(portId).finally(() => {
    inFlight.delete(portId);
  });

  inFlight.set(portId, request);
  return request;
};
