import axios from "axios";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type {
  InstalledPort,
  PortCatalogueEntry,
  PortInstallProgress,
  PortResult,
} from "@types";
import { portsSublevel } from "@main/level";
import { getDownloadsPath } from "@main/events/helpers/get-downloads-path";

import { logger } from "../logger";
import { SevenZip } from "../7zip";
import { SystemPath } from "../system-path";
import { WindowManager } from "../window-manager";
import { downloadToFile } from "../download-to-file";
import { fetchPortRelease } from "./port-release";
import { findPort } from "./ports-catalogue";
import { removePortLibraryGame, upsertPortLibraryGame } from "./ports-library";
import { installPortCore, type PortInstallerDeps } from "./port-installer-core";

const TEXT_FETCH_TIMEOUT_MS = 15_000;
const TAR_COMPRESSED_PATTERN = /\.(tar\.gz|tgz|tar\.xz)$/i;
const ARCHIVE_PATTERN = /\.(zip|7z|rar|tar|tar\.gz|tgz|tar\.xz)$/i;

const busyPortIds = new Set<string>();

const readInstalled = async (portId: string): Promise<InstalledPort | null> => {
  try {
    return (await portsSublevel.get(portId)) ?? null;
  } catch (error) {
    if (error instanceof Error && error.name === "NotFoundError") return null;
    throw error;
  }
};

const pathExists = async (target: string): Promise<boolean> => {
  try {
    await fs.promises.access(target);
    return true;
  } catch {
    return false;
  }
};

const sha256OfFile = (filePath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });

const moveEntry = async (from: string, to: string): Promise<void> => {
  try {
    await fs.promises.rename(from, to);
  } catch (error) {
    // Cross-device moves (temp dir on another drive) cannot rename.
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await fs.promises.cp(from, to, { recursive: true });
    await fs.promises.rm(from, { recursive: true, force: true });
  }
};

/** Extracts an archive. Compressed tarballs are unpacked twice: gzip/xz, then tar. */
const extractArchive = async (
  archivePath: string,
  outputDir: string
): Promise<void> => {
  if (!TAR_COMPRESSED_PATTERN.test(archivePath)) {
    await SevenZip.extractFile({
      filePath: archivePath,
      outputPath: outputDir,
    });
    return;
  }

  const unpackDir = `${archivePath}.unpacked`;
  await SevenZip.extractFile({ filePath: archivePath, outputPath: unpackDir });

  const tarName = (await fs.promises.readdir(unpackDir)).find((name) =>
    name.toLowerCase().endsWith(".tar")
  );
  if (!tarName) throw new Error(`No tar inside ${archivePath}`);

  await SevenZip.extractFile({
    filePath: path.join(unpackDir, tarName),
    outputPath: outputDir,
  });
  await fs.promises.rm(unpackDir, { recursive: true, force: true });
};

const sendProgress = (progress: PortInstallProgress): void => {
  WindowManager.mainWindow?.webContents.send(
    "on-port-install-progress",
    progress
  );
};

const buildDeps = (): PortInstallerDeps => ({
  resolveRelease: (port) => fetchPortRelease(port),
  download: async (url, dest, onProgress) => {
    await downloadToFile(url, dest, onProgress);
  },
  fetchText: async (url) => {
    const { data } = await axios.get<string>(url, {
      responseType: "text",
      headers: { "User-Agent": "HydraLauncher" },
      timeout: TEXT_FETCH_TIMEOUT_MS,
    });
    return String(data);
  },
  sha256File: sha256OfFile,
  extract: extractArchive,
  isArchive: (fileName) => ARCHIVE_PATTERN.test(fileName),
  pathExists,
  listDir: async (dir) =>
    (await fs.promises.readdir(dir, { withFileTypes: true })).map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    })),
  makeExecutable: async (target) => {
    // An archive may ship the executable as a symlink; never chmod anything
    // that resolves outside the ports folder.
    const portsRoot = await fs.promises.realpath(
      path.join(await getDownloadsPath(), "Ports")
    );
    const relative = path.relative(
      portsRoot,
      await fs.promises.realpath(target)
    );
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Port executable escapes the ports folder: ${target}`);
    }
    await fs.promises.chmod(target, 0o755);
  },
  mkdir: async (dir) => {
    await fs.promises.mkdir(dir, { recursive: true });
  },
  move: moveEntry,
  remove: (target) => fs.promises.rm(target, { recursive: true, force: true }),
  tempDir: () =>
    fs.promises.mkdtemp(path.join(SystemPath.getPath("temp"), "hydra-port-")),
  portsRoot: async () => path.join(await getDownloadsPath(), "Ports"),
  upsertLibraryGame: upsertPortLibraryGame,
  getInstalled: readInstalled,
  saveInstalled: async (record) => {
    await portsSublevel.put(record.portId, record);
  },
  platform: process.platform,
  now: () => new Date(),
  onProgress: sendProgress,
});

/**
 * Installs a catalogue port from its GitHub release and adds it to the library.
 * Concurrent installs of the same port are refused.
 */
export const installPort = async (
  portId: string
): Promise<PortResult<InstalledPort>> => {
  if (busyPortIds.has(portId)) {
    return { ok: false, error: "already_installing" };
  }

  // Claimed before any await so two quick calls cannot both start.
  busyPortIds.add(portId);
  try {
    let port: PortCatalogueEntry | null;
    try {
      port = await findPort(portId);
    } catch (error) {
      logger.error(`Port catalogue lookup failed for ${portId}`, error);
      return { ok: false, error: "catalogue_unavailable" };
    }
    if (!port) return { ok: false, error: "port_not_found" };

    return await installPortCore(port, buildDeps());
  } finally {
    busyPortIds.delete(portId);
  }
};

/** Deletes an installed port's files and its library entry. */
export const uninstallPort = async (
  portId: string
): Promise<PortResult<null>> => {
  if (busyPortIds.has(portId)) {
    return { ok: false, error: "already_installing" };
  }

  busyPortIds.add(portId);
  try {
    const record = await readInstalled(portId);
    if (!record) return { ok: false, error: "not_installed" };

    await fs.promises.rm(record.installPath, { recursive: true, force: true });
    // Drop the now empty <downloads>/Ports/<portId> folder; rmdir refuses
    // non-empty folders, so anything else left there is kept.
    await fs.promises.rmdir(path.dirname(record.installPath)).catch(() => {});
    await removePortLibraryGame(record.gameObjectId);
    await portsSublevel.del(portId);
    return { ok: true, data: null };
  } finally {
    busyPortIds.delete(portId);
  }
};

/** Installed ports whose executable still exists on disk. */
export const getInstalledPorts = async (): Promise<InstalledPort[]> => {
  const records: InstalledPort[] = [];
  for await (const record of portsSublevel.values()) {
    records.push(record);
  }

  const checks = await Promise.all(
    records.map(async (record) =>
      (await pathExists(record.executablePath)) ? record : null
    )
  );
  return checks.filter((record): record is InstalledPort => record !== null);
};
