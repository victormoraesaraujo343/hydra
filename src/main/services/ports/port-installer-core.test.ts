import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import type {
  InstalledPort,
  PortCatalogueEntry,
  PortInstallProgress,
  PortRelease,
  PortResult,
} from "../../../types/ports.types.js";
import {
  installPortCore,
  type PortInstallerDeps,
} from "./port-installer-core.js";

const ROOT = "/downloads/Ports";
const TEMP = "/tmp-root/hydra-port-1";
const PORT_DIR = `${ROOT}/port-a`;
const INSTALL_V1 = `${PORT_DIR}/v1.0.0`;
const STAGING_V1 = `${PORT_DIR}/.staging-v1.0.0`;
const SIDECAR_URL =
  "https://github.com/example/port-a/releases/download/v1.0.0/PortA-1.0.0-win64.zip.sha256";
const NOW = new Date("2026-10-13T12:00:00.000Z");
const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);

const port = (
  overrides: Partial<PortCatalogueEntry> = {}
): PortCatalogueEntry => ({
  id: "port-a",
  title: "Port A",
  platform: "ps2",
  repo: "example/port-a",
  authors: ["someone"],
  description: { en: "A port" },
  coverImageUrl: null,
  heroImageUrl: null,
  status: "playable",
  tested: true,
  channel: "latest",
  source: "curated",
  assets: {
    win32: {
      pattern: "win64\\.zip$",
      executable: "PortA-1.0.0-win64/porta.exe",
    },
  },
  game: { format: "folder", requiredFiles: [], titleIds: [], notes: null },
  requirements: null,
  setupHint: null,
  stats: null,
  ...overrides,
});

const release = (overrides: Partial<PortRelease> = {}): PortRelease => ({
  tag: "v1.0.0",
  htmlUrl: "https://github.com/example/port-a/releases/tag/v1.0.0",
  downloadUrl:
    "https://github.com/example/port-a/releases/download/v1.0.0/PortA-1.0.0-win64.zip",
  fileName: "PortA-1.0.0-win64.zip",
  size: 1024,
  sha256: HEX_A,
  sha256Url: null,
  ...overrides,
});

interface FakeOptions {
  resolved?: PortResult<PortRelease>;
  platform?: NodeJS.Platform;
  extractEntries?: string[];
  actualSha256?: string;
  sidecarText?: string;
  downloadError?: Error;
  extractError?: Error;
  previous?: InstalledPort;
  walkError?: Error;
}

const createFake = (options: FakeOptions = {}) => {
  const calls: string[] = [];
  const progress: PortInstallProgress[] = [];
  const installed = new Map<string, InstalledPort>();
  // path -> isDirectory
  const nodes = new Map<string, boolean>();

  const addDir = (dir: string) => {
    let current = dir;
    while (current !== "/" && current !== "." && !nodes.has(current)) {
      nodes.set(current, true);
      current = path.dirname(current);
    }
  };
  const addFile = (file: string) => {
    nodes.set(file, false);
    addDir(path.dirname(file));
  };
  const exists = (target: string) => nodes.has(target);
  const under = (target: string) =>
    [...nodes.keys()].filter(
      (key) => key === target || key.startsWith(`${target}/`)
    );

  if (options.previous) {
    installed.set(options.previous.portId, options.previous);
    addDir(options.previous.installPath);
    addFile(options.previous.executablePath);
  }

  const deps: PortInstallerDeps = {
    resolveRelease: async () => {
      calls.push("resolveRelease");
      return options.resolved ?? { ok: true, data: release() };
    },
    download: async (_url, dest, onProgress) => {
      calls.push(`download:${dest}`);
      if (options.downloadError) throw options.downloadError;
      addFile(dest);
      onProgress(512, 1024);
      onProgress(1024, 1024);
    },
    fetchText: async (url) => {
      calls.push(`fetchText:${url}`);
      return options.sidecarText ?? "";
    },
    sha256File: async (filePath) => {
      calls.push(`sha256File:${filePath}`);
      return options.actualSha256 ?? HEX_A;
    },
    extract: async (archivePath, outputDir) => {
      calls.push(`extract:${archivePath}->${outputDir}`);
      if (options.extractError) throw options.extractError;
      for (const entry of options.extractEntries ?? [
        "PortA-1.0.0-win64/porta.exe",
      ]) {
        addFile(path.join(outputDir, entry));
      }
    },
    isArchive: (fileName) =>
      /\.(zip|7z|rar|tar|tar\.gz|tgz|tar\.xz)$/i.test(fileName),
    pathExists: async (target) => exists(target),
    listDir: async (dir) =>
      [...nodes.keys()]
        .filter((key) => path.dirname(key) === dir && key !== dir)
        .map((key) => ({
          name: path.basename(key),
          isDirectory: nodes.get(key) === true,
        })),
    makeExecutable: async (target) => {
      calls.push(`makeExecutable:${target}`);
    },
    walk: async (root) => {
      calls.push(`walk:${root}`);
      if (options.walkError) throw options.walkError;
      return [...nodes.entries()]
        .filter(([key]) => key.startsWith(`${root}/`))
        .map(([key, isDirectory]) => ({
          relativePath: key.slice(root.length + 1),
          size: isDirectory ? 0 : 1024,
          isExecutable: true,
          isDirectory,
        }));
    },
    mkdir: async (dir) => {
      calls.push(`mkdir:${dir}`);
      addDir(dir);
    },
    move: async (from, to) => {
      calls.push(`move:${from}->${to}`);
      if (!exists(from)) throw new Error(`missing ${from}`);
      for (const key of under(from)) {
        const isDir = nodes.get(key) === true;
        nodes.delete(key);
        nodes.set(to + key.slice(from.length), isDir);
      }
      addDir(path.dirname(to));
    },
    remove: async (target) => {
      calls.push(`remove:${target}`);
      for (const key of under(target)) nodes.delete(key);
    },
    tempDir: async () => {
      calls.push("tempDir");
      addDir(TEMP);
      return TEMP;
    },
    portsRoot: async () => ROOT,
    upsertLibraryGame: async (_port, executablePath, existingObjectId) => {
      calls.push(`upsert:${executablePath}:${existingObjectId}`);
      return existingObjectId ?? "obj-new";
    },
    getInstalled: async (portId) => installed.get(portId) ?? null,
    saveInstalled: async (record) => {
      calls.push(`save:${record.version}`);
      installed.set(record.portId, record);
    },
    platform: options.platform ?? "win32",
    now: () => NOW,
    onProgress: (p) => {
      progress.push(p);
    },
  };

  return { deps, calls, progress, installed, exists, under };
};

const phasesOf = (progress: PortInstallProgress[]) => [
  ...new Set(progress.map((p) => p.phase)),
];

describe("installPortCore", () => {
  it("installs an archive, records it and cleans up temp files", async () => {
    const fake = createFake({
      extractEntries: [
        "PortA-1.0.0-win64/porta.exe",
        "PortA-1.0.0-win64/readme.txt",
      ],
    });

    const result = await installPortCore(port(), fake.deps);

    const expectedRecord: InstalledPort = {
      portId: "port-a",
      version: "v1.0.0",
      installPath: INSTALL_V1,
      executablePath: `${INSTALL_V1}/PortA-1.0.0-win64/porta.exe`,
      gameObjectId: "obj-new",
      installedAt: NOW.toISOString(),
    };
    assert.deepEqual(result, { ok: true, data: expectedRecord });
    assert.deepEqual(fake.installed.get("port-a"), expectedRecord);
    assert.equal(fake.exists(expectedRecord.executablePath), true);
    assert.deepEqual(fake.under(TEMP), []);
    assert.equal(fake.exists(STAGING_V1), false);
    assert.deepEqual(phasesOf(fake.progress), [
      "resolving",
      "downloading",
      "verifying",
      "extracting",
      "finalizing",
      "done",
    ]);
    assert.deepEqual(
      fake.progress
        .filter((p) => p.phase === "downloading" && p.loaded !== undefined)
        .map((p) => [p.loaded, p.total]),
      [
        [512, 1024],
        [1024, 1024],
      ]
    );
    assert.equal(
      fake.calls.some((call) => call.startsWith("makeExecutable:")),
      false
    );
  });

  it("makes a bare Linux binary executable after moving it into place", async () => {
    const fake = createFake({
      platform: "linux",
      extractEntries: [],
    });

    const result = await installPortCore(
      port({
        assets: {
          linux: { pattern: "AppImage$", executable: "PortA-x86_64.AppImage" },
        },
      }),
      {
        ...fake.deps,
        resolveRelease: async () => ({
          ok: true,
          data: release({ fileName: "PortA-x86_64.AppImage" }),
        }),
      }
    );

    assert.equal(result.ok, true);
    assert.equal(
      fake.calls.some((call) => call.startsWith("extract:")),
      false
    );
    assert.ok(
      fake.calls.includes(`makeExecutable:${STAGING_V1}/PortA-x86_64.AppImage`)
    );
    assert.equal(
      result.ok && result.data.executablePath,
      `${INSTALL_V1}/PortA-x86_64.AppImage`
    );
  });

  it("rejects a checksum mismatch before anything reaches the library", async () => {
    const fake = createFake({ actualSha256: HEX_B });

    const result = await installPortCore(port(), fake.deps);

    assert.deepEqual(result, { ok: false, error: "checksum_mismatch" });
    assert.equal(
      fake.calls.some((call) => call.startsWith("upsert:")),
      false
    );
    assert.equal(fake.installed.has("port-a"), false);
    assert.deepEqual(fake.under(TEMP), []);
    assert.equal(fake.exists(STAGING_V1), false);
    assert.equal(fake.exists(INSTALL_V1), false);
    assert.deepEqual(fake.progress.at(-1), {
      portId: "port-a",
      phase: "error",
      error: "checksum_mismatch",
    });
  });

  it("verifies with the sidecar checksum when GitHub gives no digest", async () => {
    const fake = createFake({
      actualSha256: HEX_A,
      sidecarText: `${HEX_A}  PortA-1.0.0-win64.zip\n`,
    });

    const result = await installPortCore(port(), {
      ...fake.deps,
      resolveRelease: async () => ({
        ok: true,
        data: release({ sha256: null, sha256Url: SIDECAR_URL }),
      }),
    });

    assert.equal(result.ok, true);
    assert.ok(fake.calls.includes(`fetchText:${SIDECAR_URL}`));
  });

  it("rejects a sidecar checksum that does not match the download", async () => {
    const fake = createFake({
      actualSha256: HEX_A,
      sidecarText: `${HEX_B}  PortA-1.0.0-win64.zip\n`,
    });

    const result = await installPortCore(port(), {
      ...fake.deps,
      resolveRelease: async () => ({
        ok: true,
        data: release({ sha256: null, sha256Url: SIDECAR_URL }),
      }),
    });

    assert.deepEqual(result, { ok: false, error: "checksum_mismatch" });
    assert.equal(fake.installed.has("port-a"), false);
  });

  it("fails closed when the sidecar has no readable checksum", async () => {
    const fake = createFake({
      actualSha256: HEX_A,
      sidecarText: "<html>rate limited</html>",
    });

    const result = await installPortCore(port(), {
      ...fake.deps,
      resolveRelease: async () => ({
        ok: true,
        data: release({ sha256: null, sha256Url: SIDECAR_URL }),
      }),
    });

    assert.deepEqual(result, { ok: false, error: "checksum_mismatch" });
    assert.equal(
      fake.calls.some((call) => call.startsWith("upsert:")),
      false
    );
  });

  it("finds the executable inside a single top-level folder", async () => {
    const fake = createFake({
      extractEntries: ["PortA-1.0.0-win64/porta.exe"],
    });

    const result = await installPortCore(
      port({
        assets: {
          win32: { pattern: "win64\\.zip$", executable: "porta.exe" },
        },
      }),
      fake.deps
    );

    assert.equal(result.ok, true);
    assert.equal(
      result.ok && result.data.executablePath,
      `${INSTALL_V1}/PortA-1.0.0-win64/porta.exe`
    );
  });

  it("reports executable_not_found and cleans up when the archive lacks the executable", async () => {
    const fake = createFake({
      extractEntries: [
        "PortA-1.0.0-win64/readme.txt",
        "PortA-1.0.0-win64/other.exe",
      ],
    });

    const result = await installPortCore(port(), fake.deps);

    assert.deepEqual(result, { ok: false, error: "executable_not_found" });
    assert.equal(
      fake.calls.some((call) => call.startsWith("upsert:")),
      false
    );
    assert.deepEqual(fake.under(TEMP), []);
    assert.equal(fake.exists(STAGING_V1), false);
    assert.equal(fake.exists(INSTALL_V1), false);
  });

  it("detects the executable when the asset has no executable path", async () => {
    const fake = createFake({
      extractEntries: [
        "PortA-1.0.0-win64/porta.exe",
        "PortA-1.0.0-win64/unins000.exe",
      ],
    });

    const result = await installPortCore(
      port({
        assets: {
          win32: { pattern: "win64\\.zip$", executable: null },
        },
      }),
      fake.deps
    );

    assert.equal(result.ok, true);
    assert.equal(
      result.ok && result.data.executablePath,
      `${INSTALL_V1}/PortA-1.0.0-win64/porta.exe`
    );
    assert.ok(fake.calls.includes(`walk:${STAGING_V1}`));
    assert.deepEqual(fake.under(TEMP), []);
    assert.equal(fake.exists(STAGING_V1), false);
  });

  it("reports executable_not_found when detection finds only installers", async () => {
    const fake = createFake({
      extractEntries: [
        "PortA-1.0.0-win64/unins000.exe",
        "PortA-1.0.0-win64/vc_redist.x64.exe",
      ],
    });

    const result = await installPortCore(
      port({
        assets: {
          win32: { pattern: "win64\\.zip$", executable: null },
        },
      }),
      fake.deps
    );

    assert.deepEqual(result, { ok: false, error: "executable_not_found" });
    assert.equal(
      fake.calls.some((call) => call.startsWith("upsert:")),
      false
    );
    assert.equal(fake.exists(STAGING_V1), false);
    assert.equal(fake.exists(INSTALL_V1), false);
    assert.deepEqual(fake.under(TEMP), []);
  });

  it("detects a Linux AppImage when the asset has no executable path", async () => {
    const fake = createFake({ platform: "linux", extractEntries: [] });

    const result = await installPortCore(
      port({
        assets: {
          linux: { pattern: "AppImage$", executable: null },
        },
      }),
      {
        ...fake.deps,
        resolveRelease: async () => ({
          ok: true,
          data: release({ fileName: "PortA-x86_64.AppImage" }),
        }),
      }
    );

    assert.equal(result.ok, true);
    assert.equal(
      result.ok && result.data.executablePath,
      `${INSTALL_V1}/PortA-x86_64.AppImage`
    );
    assert.ok(
      fake.calls.includes(`makeExecutable:${STAGING_V1}/PortA-x86_64.AppImage`)
    );
  });

  it("uses the win32 build on Linux and leaves .exe files alone when detecting", async () => {
    const fake = createFake({
      platform: "linux",
      extractEntries: ["PortA-1.0.0-win64/porta.exe"],
    });

    const result = await installPortCore(
      port({
        assets: {
          win32: { pattern: "win64\\.zip$", executable: null },
        },
      }),
      fake.deps
    );

    assert.equal(result.ok, true);
    assert.equal(
      result.ok && result.data.executablePath,
      `${INSTALL_V1}/PortA-1.0.0-win64/porta.exe`
    );
    assert.equal(
      fake.calls.some((call) => call.startsWith("makeExecutable:")),
      false
    );
  });

  it("maps a failed folder listing to extract_failed and cleans up", async () => {
    const fake = createFake({ walkError: new Error("EACCES") });

    const result = await installPortCore(
      port({
        assets: {
          win32: { pattern: "win64\\.zip$", executable: null },
        },
      }),
      fake.deps
    );

    assert.deepEqual(result, { ok: false, error: "extract_failed" });
    assert.equal(fake.exists(STAGING_V1), false);
    assert.deepEqual(fake.under(TEMP), []);
  });

  it("keeps the library game and removes the old version only after the new one is saved", async () => {
    const previousInstall = `${PORT_DIR}/v0.9.0`;
    const fake = createFake({
      previous: {
        portId: "port-a",
        version: "v0.9.0",
        installPath: previousInstall,
        executablePath: `${previousInstall}/PortA-1.0.0-win64/porta.exe`,
        gameObjectId: "obj-old",
        installedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const result = await installPortCore(port(), fake.deps);

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.data.gameObjectId, "obj-old");
    assert.ok(
      fake.calls.includes(
        `upsert:${INSTALL_V1}/PortA-1.0.0-win64/porta.exe:obj-old`
      )
    );
    assert.equal(fake.exists(previousInstall), false);
    assert.ok(
      fake.calls.indexOf("save:v1.0.0") <
        fake.calls.indexOf(`remove:${previousInstall}`)
    );
  });

  it("keeps the previous install untouched when the update fails", async () => {
    const previousInstall = `${PORT_DIR}/v0.9.0`;
    const previous: InstalledPort = {
      portId: "port-a",
      version: "v0.9.0",
      installPath: previousInstall,
      executablePath: `${previousInstall}/PortA-1.0.0-win64/porta.exe`,
      gameObjectId: "obj-old",
      installedAt: "2026-01-01T00:00:00.000Z",
    };
    const fake = createFake({ previous, actualSha256: HEX_B });

    const result = await installPortCore(port(), fake.deps);

    assert.deepEqual(result, { ok: false, error: "checksum_mismatch" });
    assert.equal(fake.exists(previous.executablePath), true);
    assert.deepEqual(fake.installed.get("port-a"), previous);
    assert.equal(
      fake.calls.some((call) => call.startsWith(`remove:${previousInstall}`)),
      false
    );
  });

  it("passes a release resolution error through without downloading", async () => {
    const fake = createFake({
      resolved: { ok: false, error: "release_unavailable" },
    });

    const result = await installPortCore(port(), fake.deps);

    assert.deepEqual(result, { ok: false, error: "release_unavailable" });
    assert.equal(
      fake.calls.some((call) => call.startsWith("download:")),
      false
    );
    assert.deepEqual(fake.progress.at(-1), {
      portId: "port-a",
      phase: "error",
      error: "release_unavailable",
    });
  });

  it("reports no_asset_for_platform when the catalogue has no build for this OS", async () => {
    const fake = createFake({ platform: "darwin" });

    const result = await installPortCore(port(), fake.deps);

    assert.deepEqual(result, { ok: false, error: "no_asset_for_platform" });
    assert.equal(
      fake.calls.some((call) => call.startsWith("download:")),
      false
    );
  });

  it("maps a failed download to download_failed and removes temp files", async () => {
    const fake = createFake({ downloadError: new Error("socket hang up") });

    const result = await installPortCore(port(), fake.deps);

    assert.deepEqual(result, { ok: false, error: "download_failed" });
    assert.deepEqual(fake.under(TEMP), []);
    assert.equal(
      fake.calls.some((call) => call.startsWith("upsert:")),
      false
    );
  });

  it("maps a failed extraction to extract_failed and removes the staging folder", async () => {
    const fake = createFake({ extractError: new Error("corrupt archive") });

    const result = await installPortCore(port(), fake.deps);

    assert.deepEqual(result, { ok: false, error: "extract_failed" });
    assert.equal(fake.exists(STAGING_V1), false);
    assert.deepEqual(fake.under(TEMP), []);
  });

  it("uses a filesystem-safe folder name for tags containing slashes", async () => {
    const fake = createFake();

    const result = await installPortCore(port(), {
      ...fake.deps,
      resolveRelease: async () => ({
        ok: true,
        data: release({ tag: "v1.0.0/beta" }),
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(
      result.ok && result.data.installPath,
      `${PORT_DIR}/v1.0.0_beta`
    );
    assert.equal(result.ok && result.data.version, "v1.0.0/beta");
  });

  it("never installs into the ports root for a tag made of dots", async () => {
    const fake = createFake();

    const result = await installPortCore(port(), {
      ...fake.deps,
      resolveRelease: async () => ({
        ok: true,
        data: release({ tag: ".." }),
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.data.installPath, `${PORT_DIR}/_..`);
    assert.equal(fake.exists(PORT_DIR), true);
  });
});
