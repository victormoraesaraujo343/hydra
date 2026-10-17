import path from "node:path";
import { randomUUID } from "node:crypto";

import type {
  InstalledPort,
  PortAsset,
  PortCatalogueEntry,
  PortErrorCode,
  PortInstallProgress,
  PortOs,
  PortRelease,
  PortResult,
} from "../../../types/ports.types.js";
import {
  detectPortExecutable,
  type PortFileEntry,
} from "./port-executable-detect.js";
import { parseSha256File } from "./port-release-parse.js";

export interface PortInstallerDeps {
  resolveRelease: (
    port: PortCatalogueEntry
  ) => Promise<PortResult<PortRelease>>;
  download: (
    url: string,
    dest: string,
    onProgress: (loaded: number, total: number | null) => void
  ) => Promise<void>;
  fetchText: (url: string) => Promise<string>;
  sha256File: (filePath: string) => Promise<string>;
  extract: (archivePath: string, outputDir: string) => Promise<void>;
  isArchive: (fileName: string) => boolean;
  pathExists: (p: string) => Promise<boolean>;
  listDir: (p: string) => Promise<{ name: string; isDirectory: boolean }[]>;
  makeExecutable: (p: string) => Promise<void>;
  /** Lists a folder recursively (relative "/" paths, bounded depth and count). */
  walk: (root: string) => Promise<PortFileEntry[]>;
  mkdir: (p: string) => Promise<void>;
  move: (from: string, to: string) => Promise<void>;
  remove: (p: string) => Promise<void>;
  tempDir: () => Promise<string>;
  portsRoot: () => Promise<string>;
  upsertLibraryGame: (
    port: PortCatalogueEntry,
    executablePath: string,
    existingObjectId: string | null
  ) => Promise<string>;
  getInstalled: (portId: string) => Promise<InstalledPort | null>;
  saveInstalled: (record: InstalledPort) => Promise<void>;
  preserveUserData: (
    port: PortCatalogueEntry,
    previous: InstalledPort,
    staging: string,
    relativeExecutable: string
  ) => Promise<void>;
  removeLibraryGame: (objectId: string) => Promise<void>;
  platform: NodeJS.Platform;
  now: () => Date;
  onProgress: (p: PortInstallProgress) => void;
}

type Emit = (
  phase: PortInstallProgress["phase"],
  fields?: Partial<Omit<PortInstallProgress, "portId" | "phase">>
) => void;

interface InstallState {
  tempDir: string | null;
  staging: string | null;
  finalDir: string | null;
  previous: InstalledPort | null;
  backup: string | null;
  libraryAttempted: boolean;
  gameObjectId: string | null;
}

/** Carries a PortErrorCode out of the install steps. */
class PortInstallFailure extends Error {
  readonly code: PortErrorCode;

  constructor(code: PortErrorCode) {
    super(code);
    this.code = code;
  }
}

/** Runs one step; any unexpected throw becomes the given error code. */
const step = async <T>(
  code: PortErrorCode,
  work: () => Promise<T>
): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PortInstallFailure) throw error;
    throw new PortInstallFailure(code);
  }
};

const removeQuietly = (deps: PortInstallerDeps, target: string) =>
  deps.remove(target).catch(() => undefined);

const sameInstallPath = (
  first: string,
  second: string,
  platform: NodeJS.Platform
): boolean => {
  const normalize = (value: string) =>
    platform === "win32"
      ? path.resolve(value).toLowerCase()
      : path.resolve(value);
  return normalize(first) === normalize(second);
};

/** Makes a release tag safe as one folder name (never "", "." or ".."). */
const sanitizeSegment = (value: string): string => {
  const safe = value.replace(/[^A-Za-z0-9._-]/g, "_");
  return /^\.*$/.test(safe) ? `_${safe}` : safe;
};

const isInsideRoot = (relativePath: string): boolean => {
  const normalized = path.normalize(relativePath);
  return !path.isAbsolute(normalized) && !normalized.startsWith("..");
};

/**
 * Finds the executable relative to the staging folder. Accepts the path as
 * written, or the same path inside the only top-level folder of the archive.
 */
const findExecutable = async (
  deps: PortInstallerDeps,
  root: string,
  relativePath: string
): Promise<string | null> => {
  if (!isInsideRoot(relativePath)) return null;

  if (await deps.pathExists(path.join(root, relativePath))) {
    return relativePath;
  }

  const topDirs = (await deps.listDir(root)).filter(
    (entry) => entry.isDirectory
  );
  if (topDirs.length !== 1) return null;

  const nested = path.join(topDirs[0].name, relativePath);
  return (await deps.pathExists(path.join(root, nested))) ? nested : null;
};

/**
 * The asset key the release is built for: the exact OS, else win32 on Linux
 * (same fallback as pickPortAsset in port-release-parse.ts).
 */
const pickAssetOs = (
  assets: Partial<Record<PortOs, PortAsset>>,
  platform: NodeJS.Platform
): PortOs | null => {
  if (
    (platform === "win32" || platform === "linux" || platform === "darwin") &&
    assets[platform]
  ) {
    return platform;
  }
  return platform === "linux" && assets.win32 ? "win32" : null;
};

const resolveExpectedSha256 = async (
  release: PortRelease,
  deps: PortInstallerDeps
): Promise<string | null> => {
  if (release.sha256) return release.sha256;
  if (!release.sha256Url) return null;

  const sidecarText = await step("download_failed", () =>
    deps.fetchText(release.sha256Url as string)
  );
  const parsed = parseSha256File(sidecarText);
  // A published sidecar that cannot be read must not silently skip verification.
  if (!parsed) throw new PortInstallFailure("checksum_mismatch");
  return parsed;
};

const runInstall = async (
  port: PortCatalogueEntry,
  deps: PortInstallerDeps,
  state: InstallState,
  emit: Emit
): Promise<InstalledPort> => {
  emit("resolving");
  const resolved = await step("release_unavailable", () =>
    deps.resolveRelease(port)
  );
  if (!resolved.ok) throw new PortInstallFailure(resolved.error);
  const release = resolved.data;

  const assetOs = pickAssetOs(port.assets, deps.platform);
  const asset: PortAsset | null = assetOs
    ? (port.assets[assetOs] ?? null)
    : null;
  if (!assetOs || !asset) throw new PortInstallFailure("no_asset_for_platform");

  const fileName = path.basename(release.fileName);
  if (!fileName || fileName === "." || fileName === "..") {
    throw new PortInstallFailure("release_unavailable");
  }

  const tempRoot = await step("download_failed", () => deps.tempDir());
  state.tempDir = tempRoot;
  const archivePath = path.join(tempRoot, fileName);

  emit("downloading");
  await step("download_failed", () =>
    deps.download(release.downloadUrl, archivePath, (loaded, total) =>
      emit("downloading", { loaded, total: total ?? undefined })
    )
  );

  emit("verifying");
  const expectedSha256 = await resolveExpectedSha256(release, deps);
  if (expectedSha256) {
    const actualSha256 = await step("download_failed", () =>
      deps.sha256File(archivePath)
    );
    if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
      throw new PortInstallFailure("checksum_mismatch");
    }
  }

  emit("extracting");
  const root = await step("extract_failed", () => deps.portsRoot());
  const portDir = path.join(root, port.id);
  const folderName = sanitizeSegment(release.tag);
  const staging = path.join(portDir, `.staging-${folderName}`);
  state.staging = staging;

  await step("extract_failed", async () => {
    await deps.remove(staging);
    await deps.mkdir(staging);
  });

  if (deps.isArchive(fileName)) {
    await step("extract_failed", () => deps.extract(archivePath, staging));
  } else {
    await step("extract_failed", () =>
      deps.move(archivePath, path.join(staging, fileName))
    );
  }

  const relativeExe = await step("extract_failed", async () =>
    asset.executable !== null
      ? findExecutable(deps, staging, asset.executable)
      : detectPortExecutable(
          await deps.walk(staging),
          deps.platform,
          assetOs,
          port.title
        )
  );
  if (!relativeExe) throw new PortInstallFailure("executable_not_found");

  // App bundles are launched as a whole, never by file mode.
  const lowerExe = relativeExe.toLowerCase();
  if (
    deps.platform !== "win32" &&
    !lowerExe.endsWith(".exe") &&
    !lowerExe.endsWith(".app")
  ) {
    await step("extract_failed", () =>
      deps.makeExecutable(path.join(staging, relativeExe))
    );
  }

  emit("finalizing");
  const finalDir = path.join(portDir, folderName);
  const previous = await step("extract_failed", () =>
    deps.getInstalled(port.id)
  );
  state.previous = previous;
  if (previous) {
    await step("extract_failed", () =>
      deps.preserveUserData(port, previous, staging, relativeExe)
    );
  }
  // Keep an existing target recoverable, including same-release reinstalls.
  if (await deps.pathExists(finalDir)) {
    const backup = path.join(portDir, `.previous-${randomUUID()}`);
    await step("extract_failed", () => deps.move(finalDir, backup));
    state.backup = backup;
  }
  state.finalDir = finalDir;
  await step("extract_failed", async () => {
    await deps.move(staging, finalDir);
  });
  state.staging = null;

  const finalExe = path.join(finalDir, relativeExe);
  state.libraryAttempted = true;
  const gameObjectId = await step("extract_failed", () =>
    deps.upsertLibraryGame(port, finalExe, previous?.gameObjectId ?? null)
  );
  state.gameObjectId = gameObjectId;

  const record: InstalledPort = {
    portId: port.id,
    version: release.tag,
    installPath: finalDir,
    executablePath: finalExe,
    gameObjectId,
    installedAt: deps.now().toISOString(),
  };
  await step("extract_failed", () => deps.saveInstalled(record));

  if (
    previous &&
    !sameInstallPath(previous.installPath, finalDir, deps.platform)
  ) {
    await removeQuietly(deps, previous.installPath);
  }
  if (state.backup) await removeQuietly(deps, state.backup);

  return record;
};

/**
 * Installs one port: resolve the release, download, verify, extract into a
 * staging folder, move it into place, then register the library game and the
 * install record. The previous version is removed only after the new one is
 * saved. Failed updates restore the previous installation where possible;
 * files are retained if metadata rollback fails.
 */
export const installPortCore = async (
  port: PortCatalogueEntry,
  deps: PortInstallerDeps
): Promise<PortResult<InstalledPort>> => {
  const emit: Emit = (phase, fields = {}) =>
    deps.onProgress({ portId: port.id, phase, ...fields });

  const state: InstallState = {
    tempDir: null,
    staging: null,
    finalDir: null,
    previous: null,
    backup: null,
    libraryAttempted: false,
    gameObjectId: null,
  };
  let outcome: PortResult<InstalledPort>;

  try {
    const data = await runInstall(port, deps, state, emit);
    outcome = { ok: true, data };
  } catch (error) {
    const code =
      error instanceof PortInstallFailure ? error.code : "extract_failed";

    if (state.staging) await removeQuietly(deps, state.staging);
    let restored = true;
    if (state.backup && state.finalDir) {
      try {
        await deps.remove(state.finalDir);
        await deps.move(state.backup, state.finalDir);
      } catch {
        restored = false;
      }
    }
    if (state.libraryAttempted) {
      try {
        if (state.previous) {
          await deps.upsertLibraryGame(
            port,
            state.previous.executablePath,
            state.previous.gameObjectId
          );
          await deps.saveInstalled(state.previous);
        } else if (state.gameObjectId) {
          await deps.removeLibraryGame(state.gameObjectId);
        }
      } catch {
        restored = false;
      }
    }
    // If metadata rollback fails, retain files at both possible launch paths.
    if (restored && state.finalDir && !state.backup) {
      await removeQuietly(deps, state.finalDir);
    }

    outcome = { ok: false, error: code };
  } finally {
    if (state.tempDir) await removeQuietly(deps, state.tempDir);
  }

  if (outcome.ok) {
    emit("done");
  } else {
    emit("error", { error: outcome.error });
  }

  return outcome;
};
