import axios from "axios";

import type { PortCatalogueEntry, PortRelease, PortResult } from "@types";

import { logger } from "../logger";
import {
  type GithubRelease,
  parsePortRelease,
  pickPortAsset,
  pickRelease,
} from "./port-release-parse";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_TIMEOUT_MS = 15_000;
const GITHUB_RELEASES_PAGE_SIZE = 20;
const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  expiresAt: number;
  value: PortRelease;
}

const releaseCache = new Map<string, CacheEntry>();

const unavailable = (
  port: PortCatalogueEntry,
  reason: string,
  error?: unknown
): PortResult<PortRelease> => {
  logger.error(`Port ${port.id} release unavailable: ${reason}`, error);
  return { ok: false, error: "release_unavailable" };
};

export const fetchPortRelease = async (
  port: PortCatalogueEntry,
  platform: NodeJS.Platform = process.platform
): Promise<PortResult<PortRelease>> => {
  const asset = pickPortAsset(port.assets, platform);
  if (!asset) return { ok: false, error: "no_asset_for_platform" };

  const cached = releaseCache.get(port.id);
  if (cached && cached.expiresAt > Date.now()) {
    return { ok: true, data: cached.value };
  }

  try {
    const { data } = await axios.get<GithubRelease[]>(
      `${GITHUB_API}/repos/${port.repo}/releases?per_page=${GITHUB_RELEASES_PAGE_SIZE}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "HydraLauncher",
        },
        timeout: GITHUB_API_TIMEOUT_MS,
      }
    );

    if (!Array.isArray(data)) {
      return unavailable(port, "unexpected response");
    }

    const release = pickRelease(data, port.channel);
    if (!release) return unavailable(port, "no usable release");

    const parsed = parsePortRelease(release, asset);
    if (!parsed) return unavailable(port, "no matching asset");

    releaseCache.set(port.id, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value: parsed,
    });
    return { ok: true, data: parsed };
  } catch (error) {
    return unavailable(port, "request failed", error);
  }
};
