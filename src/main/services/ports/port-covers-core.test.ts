import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PortCoversCacheEntry } from "../../../types/ports.types.js";
import {
  COVERS_MISS_TTL_MS,
  CoversHttpError,
  CoversInvalidKeyError,
  STEAMGRIDDB_API,
  cleanTitleForSearch,
  isCoversCacheEntryUsable,
  resolvePortCovers,
  type PortCoversDeps,
} from "./port-covers-core.js";

const SEARCH_URL = `${STEAMGRIDDB_API}/search/autocomplete/`;
const GRID_URL = `${STEAMGRIDDB_API}/grids/game/42?dimensions=600x900&types=static`;
const HERO_URL = `${STEAMGRIDDB_API}/heroes/game/42`;

/** Builds a fake fetchJson from a URL -> response map. Unknown URLs throw 500. */
const fakeFetch = (
  responses: Record<string, unknown | (() => unknown)>
): { deps: PortCoversDeps; calls: string[] } => {
  const calls: string[] = [];

  const deps: PortCoversDeps = {
    fetchJson: async (url: string) => {
      calls.push(url);

      const key = Object.keys(responses).find((candidate) =>
        url.startsWith(candidate)
      );
      if (key === undefined) throw new CoversHttpError(500);

      const response = responses[key];
      return typeof response === "function" ? response() : response;
    },
  };

  return { deps, calls };
};

describe("cleanTitleForSearch", () => {
  it("drops parenthetical parts and port words", () => {
    assert.equal(
      cleanTitleForSearch("God of War III Remastered (PC port)"),
      "God of War III Remastered"
    );
  });

  it("keeps a single word that only contains a dropped word", () => {
    assert.equal(cleanTitleForSearch("Rush2Recompiled"), "Rush2Recompiled");
  });

  it("drops a trailing recomp word", () => {
    assert.equal(cleanTitleForSearch("Zelda64 Recomp"), "Zelda64");
  });

  it("is case-insensitive and collapses spaces", () => {
    assert.equal(
      cleanTitleForSearch("  Super   Mario  NATIVE  Remake (Fan) "),
      "Super Mario"
    );
  });

  it("returns an empty string when nothing is left", () => {
    assert.equal(cleanTitleForSearch("(PC Port)"), "");
  });
});

describe("resolvePortCovers", () => {
  it("picks the first grid and the first hero", async () => {
    const { deps, calls } = fakeFetch({
      [SEARCH_URL]: { success: true, data: [{ id: 42 }, { id: 7 }] },
      [GRID_URL]: {
        success: true,
        data: [
          { url: "https://cdn/grid-1.png" },
          { url: "https://cdn/grid-2.png" },
        ],
      },
      [HERO_URL]: { success: true, data: [{ url: "https://cdn/hero-1.png" }] },
    });

    const covers = await resolvePortCovers({ title: "Zelda64 Recomp" }, deps);

    assert.deepEqual(covers, {
      cover: "https://cdn/grid-1.png",
      hero: "https://cdn/hero-1.png",
    });
    assert.equal(calls[0], `${SEARCH_URL}Zelda64`);
    assert.ok(calls.includes(GRID_URL));
    assert.ok(calls.includes(HERO_URL));
  });

  it("returns nulls when the search has no results", async () => {
    const { deps, calls } = fakeFetch({
      [SEARCH_URL]: { success: true, data: [] },
    });

    const covers = await resolvePortCovers({ title: "Unknown Game" }, deps);

    assert.deepEqual(covers, { cover: null, hero: null });
    assert.equal(calls.length, 1);
  });

  it("throws invalid_key on a 401 from the search", async () => {
    const { deps } = fakeFetch({
      [SEARCH_URL]: () => {
        throw new CoversHttpError(401);
      },
    });

    await assert.rejects(
      resolvePortCovers({ title: "Zelda" }, deps),
      (error: unknown) =>
        error instanceof CoversInvalidKeyError && error.code === "invalid_key"
    );
  });

  it("throws invalid_key on a 403 from the grid endpoint", async () => {
    const { deps } = fakeFetch({
      [SEARCH_URL]: { success: true, data: [{ id: 42 }] },
      [GRID_URL]: () => {
        throw new CoversHttpError(403);
      },
    });

    await assert.rejects(
      resolvePortCovers({ title: "Zelda" }, deps),
      CoversInvalidKeyError
    );
  });

  it("keeps the hero when the grid endpoint fails", async () => {
    const { deps, calls } = fakeFetch({
      [SEARCH_URL]: { success: true, data: [{ id: 42 }] },
      [GRID_URL]: () => {
        throw new CoversHttpError(500);
      },
      [HERO_URL]: { success: true, data: [{ url: "https://cdn/hero.png" }] },
    });

    const covers = await resolvePortCovers({ title: "Zelda" }, deps);

    assert.deepEqual(covers, { cover: null, hero: "https://cdn/hero.png" });
    assert.ok(calls.includes(HERO_URL));
  });
});

describe("isCoversCacheEntryUsable", () => {
  const NOW = Date.parse("2026-10-13T12:00:00.000Z");

  const entry = (
    overrides: Partial<PortCoversCacheEntry>
  ): PortCoversCacheEntry => ({
    cover: null,
    hero: null,
    checkedAt: new Date(NOW).toISOString(),
    ...overrides,
  });

  it("reuses a hit regardless of age", () => {
    const old = new Date(NOW - 365 * 24 * 60 * 60 * 1000).toISOString();

    assert.equal(
      isCoversCacheEntryUsable(
        entry({ cover: "https://cdn/c.png", checkedAt: old }),
        NOW
      ),
      true
    );
  });

  it("reuses a miss for 7 days only", () => {
    const sixDaysAgo = new Date(
      NOW - COVERS_MISS_TTL_MS + 60_000
    ).toISOString();
    const eightDaysAgo = new Date(
      NOW - COVERS_MISS_TTL_MS - 60_000
    ).toISOString();

    assert.equal(
      isCoversCacheEntryUsable(entry({ checkedAt: sixDaysAgo }), NOW),
      true
    );
    assert.equal(
      isCoversCacheEntryUsable(entry({ checkedAt: eightDaysAgo }), NOW),
      false
    );
  });
});
