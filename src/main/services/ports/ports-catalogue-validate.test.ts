import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validatePortsCatalogue } from "./ports-catalogue-validate.js";

const valid = {
  id: "god-of-war-3-remastered",
  title: "God of War III Remastered",
  platform: "ps4",
  repo: "FelipePrado0/gow3_pc",
  authors: ["Felipe Prado"],
  description: { en: "Native PC port." },
  status: "playable",
  tested: true,
  assets: {
    win32: {
      pattern: "^gow3-windows\\.zip$",
      executable: "God of War III.exe",
    },
  },
  game: {
    format: "folder",
    requiredFiles: ["eboot.bin", "sce_sys"],
    titleIds: ["CUSA01623"],
  },
  stats: { stars: 1345, pushedAt: "2026-10-13T00:00:00Z" },
};

describe("validatePortsCatalogue", () => {
  it("keeps explicit user data preservation paths", () => {
    const { ports } = validatePortsCatalogue({
      ports: [
        {
          ...valid,
          assets: {
            win32: {
              ...valid.assets.win32,
              preservePaths: ["user", "bbport.ini"],
            },
          },
        },
      ],
    });
    assert.deepEqual(ports[0].assets.win32?.preservePaths, [
      "user",
      "bbport.ini",
    ]);
  });

  it("rejects malformed or escaping preservation paths", () => {
    for (const preservePaths of [
      null,
      "user",
      ["../save"],
      ["C:\\save"],
      ["/save"],
      ["user//save"],
      [1],
      new Array(33).fill("user"),
    ]) {
      const { ports } = validatePortsCatalogue({
        ports: [
          {
            ...valid,
            assets: { win32: { ...valid.assets.win32, preservePaths } },
          },
        ],
      });
      assert.equal(ports.length, 0);
    }
  });

  it("keeps a valid entry and fills defaults", () => {
    const { ports, skipped } = validatePortsCatalogue({
      version: 1,
      ports: [valid],
    });

    assert.deepEqual(skipped, []);
    assert.deepEqual(ports, [
      {
        id: "god-of-war-3-remastered",
        title: "God of War III Remastered",
        platform: "ps4",
        repo: "FelipePrado0/gow3_pc",
        authors: ["Felipe Prado"],
        description: { en: "Native PC port." },
        coverImageUrl: null,
        heroImageUrl: null,
        status: "playable",
        tested: true,
        channel: "latest",
        source: "curated",
        assets: {
          win32: {
            pattern: "^gow3-windows\\.zip$",
            executable: "God of War III.exe",
          },
        },
        game: {
          format: "folder",
          requiredFiles: ["eboot.bin", "sce_sys"],
          titleIds: ["CUSA01623"],
          notes: null,
        },
        requirements: null,
        setupHint: null,
        stats: { stars: 1345, pushedAt: "2026-10-13T00:00:00Z" },
      },
    ]);
  });

  it("skips an entry with a bad regex and keeps the next valid one", () => {
    const { ports, skipped } = validatePortsCatalogue({
      ports: [
        {
          ...valid,
          id: "bad-regex",
          assets: { win32: { pattern: "(", executable: "game.exe" } },
        },
        { ...valid, id: "good-one" },
      ],
    });

    assert.deepEqual(
      ports.map((port) => port.id),
      ["good-one"]
    );
    assert.deepEqual(skipped, [{ index: 0, reason: "no_assets" }]);
  });

  it("skips an entry without repo and keeps the next valid one", () => {
    const { ports, skipped } = validatePortsCatalogue({
      ports: [
        { ...valid, id: "no-repo", repo: undefined },
        { ...valid, id: "good-one" },
      ],
    });

    assert.deepEqual(
      ports.map((port) => port.id),
      ["good-one"]
    );
    assert.equal(skipped[0].index, 0);
    assert.equal(skipped.length, 1);
  });

  it("skips duplicate ids after the first occurrence", () => {
    const { ports, skipped } = validatePortsCatalogue({
      ports: [
        { ...valid, id: "same-id", title: "First" },
        { ...valid, id: "same-id", title: "Second" },
      ],
    });

    assert.equal(ports.length, 1);
    assert.equal(ports[0].title, "First");
    assert.deepEqual(skipped, [{ index: 1, reason: "duplicate_id" }]);
  });

  it("maps an unknown platform to other", () => {
    const { ports, skipped } = validatePortsCatalogue({
      ports: [{ ...valid, platform: "amiga" }],
    });

    assert.deepEqual(skipped, []);
    assert.equal(ports[0].platform, "other");
  });

  it("accepts the retro platforms added for auto imports", () => {
    const platforms = [
      "nes",
      "snes",
      "gb",
      "gbc",
      "gba",
      "ds",
      "3ds",
      "wiiu",
      "genesis",
      "saturn",
      "dreamcast",
      "arcade",
    ];
    const { ports, skipped } = validatePortsCatalogue({
      ports: platforms.map((platform, index) => ({
        ...valid,
        id: `retro-${index}`,
        platform,
      })),
    });

    assert.deepEqual(skipped, []);
    assert.deepEqual(
      ports.map((port) => port.platform),
      platforms
    );
  });

  it("keeps an asset with a null executable as null", () => {
    const { ports, skipped } = validatePortsCatalogue({
      ports: [
        {
          ...valid,
          assets: {
            win32: { pattern: "^gow3-windows\\.zip$", executable: null },
          },
        },
      ],
    });

    assert.deepEqual(skipped, []);
    assert.deepEqual(ports[0].assets, {
      win32: { pattern: "^gow3-windows\\.zip$", executable: null },
    });
  });

  it("treats a missing executable as null", () => {
    const { ports, skipped } = validatePortsCatalogue({
      ports: [
        {
          ...valid,
          assets: { linux: { pattern: "AppImage$" } },
        },
      ],
    });

    assert.deepEqual(skipped, []);
    assert.deepEqual(ports[0].assets, {
      linux: { pattern: "AppImage$", executable: null },
    });
  });

  it("still rejects a non-string executable that is not null", () => {
    const { ports, skipped } = validatePortsCatalogue({
      ports: [
        {
          ...valid,
          assets: { win32: { pattern: "^gow3\\.zip$", executable: 42 } },
        },
      ],
    });

    assert.deepEqual(ports, []);
    assert.deepEqual(skipped, [{ index: 0, reason: "no_assets" }]);
  });

  it("marks an entry as auto only when source is exactly auto", () => {
    const { ports } = validatePortsCatalogue({
      ports: [
        { ...valid, id: "auto-one", source: "auto" },
        { ...valid, id: "curated-missing" },
        { ...valid, id: "curated-explicit", source: "curated" },
        { ...valid, id: "other-value", source: "AUTO" },
      ],
    });

    assert.deepEqual(
      ports.map((port) => [port.id, port.source]),
      [
        ["auto-one", "auto"],
        ["curated-missing", "curated"],
        ["curated-explicit", "curated"],
        ["other-value", "curated"],
      ]
    );
  });

  it("drops an executable that escapes the install folder", () => {
    const { ports, skipped } = validatePortsCatalogue({
      ports: [
        {
          ...valid,
          assets: {
            win32: { pattern: "^gow3\\.zip$", executable: "../evil.exe" },
          },
        },
      ],
    });

    assert.deepEqual(ports, []);
    assert.deepEqual(skipped, [{ index: 0, reason: "no_assets" }]);
  });

  it("reports an invalid root when it is null", () => {
    assert.deepEqual(validatePortsCatalogue(null), {
      ports: [],
      skipped: [{ index: -1, reason: "invalid_root" }],
    });
  });

  it("reports an invalid root when ports is missing", () => {
    assert.deepEqual(validatePortsCatalogue({ version: 1 }), {
      ports: [],
      skipped: [{ index: -1, reason: "invalid_root" }],
    });
  });

  it("skips an entry whose description has no en text", () => {
    const { ports, skipped } = validatePortsCatalogue({
      ports: [{ ...valid, description: { pt: "Porta nativa." } }],
    });

    assert.deepEqual(ports, []);
    assert.deepEqual(skipped, [{ index: 0, reason: "missing_description" }]);
  });
});
