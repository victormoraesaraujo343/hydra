import axios from "axios";

import { portsCatalogueCacheSublevel } from "@main/level";
import type { PortCatalogueEntry, PortResult, PortsCatalogue } from "@types";

import { logger } from "../logger";
import { validatePortsCatalogue } from "./ports-catalogue-validate";

export const DEFAULT_PORTS_CATALOGUE_URL =
  "https://raw.githubusercontent.com/victormoraesaraujo343/lab-hydra-ports-catalogue/main/ports-catalogue.json";

const CATALOGUE_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export const portsCatalogueUrl = (): string =>
  import.meta.env.MAIN_VITE_PORTS_CATALOGUE_URL || DEFAULT_PORTS_CATALOGUE_URL;

const readCache = async (url: string): Promise<PortsCatalogue | null> => {
  try {
    return (await portsCatalogueCacheSublevel.get(url)) ?? null;
  } catch (error) {
    logger.warn("Failed to read ports catalogue cache", error);
    return null;
  }
};

const writeCache = async (url: string, catalogue: PortsCatalogue) => {
  try {
    await portsCatalogueCacheSublevel.put(url, catalogue);
  } catch (error) {
    logger.warn("Failed to write ports catalogue cache", error);
  }
};

const isFresh = (catalogue: PortsCatalogue): boolean => {
  const fetchedAt = Date.parse(catalogue.fetchedAt);
  return Number.isFinite(fetchedAt) && Date.now() - fetchedAt < CACHE_TTL_MS;
};

/**
 * Returns the ports catalogue. Uses the cache for the current URL while it is
 * younger than 6 hours, unless `forceRefresh` is set. On a fetch failure it
 * falls back to the cached copy, if any.
 */
export const getPortsCatalogue = async (
  forceRefresh = false
): Promise<PortResult<PortsCatalogue>> => {
  const url = portsCatalogueUrl();
  const cached = await readCache(url);

  if (cached && !forceRefresh && isFresh(cached)) {
    return { ok: true, data: cached };
  }

  try {
    const { data } = await axios.get<unknown>(url, {
      timeout: CATALOGUE_TIMEOUT_MS,
      headers: { "User-Agent": "HydraLauncher" },
    });

    const { ports, skipped } = validatePortsCatalogue(data);

    if (skipped.some((item) => item.reason === "invalid_root")) {
      throw new Error("Ports catalogue has an invalid root");
    }

    for (const item of skipped) {
      logger.warn(
        `Skipped ports catalogue entry ${item.index}: ${item.reason}`
      );
    }

    const catalogue: PortsCatalogue = {
      sourceUrl: url,
      fetchedAt: new Date().toISOString(),
      ports,
    };

    await writeCache(url, catalogue);
    return { ok: true, data: catalogue };
  } catch (error) {
    logger.error(`Failed to fetch ports catalogue from ${url}`, error);

    if (cached) return { ok: true, data: cached };
    return { ok: false, error: "catalogue_unavailable" };
  }
};

export const findPort = async (
  portId: string
): Promise<PortCatalogueEntry | null> => {
  const result = await getPortsCatalogue();
  if (!result.ok) return null;
  return result.data.ports.find((port) => port.id === portId) ?? null;
};
