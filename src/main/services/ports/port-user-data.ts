import fs from "node:fs/promises";
import path from "node:path";

import type {
  InstalledPort,
  PortCatalogueEntry,
} from "../../../types/ports.types.js";

const BLOODBORNE_REPOSITORY = "supermedo/bloodborne_pc";

export const isSafePreservationPath = (value: string): boolean =>
  value.length > 0 &&
  !/[<>:"|?*]/.test(value) &&
  ![...value].some((character) => character.charCodeAt(0) < 32) &&
  !path.win32.isAbsolute(value) &&
  !path.posix.isAbsolute(value) &&
  value
    .split(/[\\/]/)
    .every(
      (part) =>
        part !== "" && part !== "." && part !== ".." && !/[. ]$/.test(part)
    );

export const getPortPreservationPaths = (
  port: PortCatalogueEntry,
  platform: NodeJS.Platform
): string[] => {
  const asset =
    port.assets[platform as keyof typeof port.assets] ??
    (platform === "linux" ? port.assets.win32 : undefined);
  if (asset?.preservePaths !== undefined) return asset.preservePaths;
  // Older catalogues do not declare preservation paths yet.
  return port.repo.toLowerCase() === BLOODBORNE_REPOSITORY
    ? ["user", "bbport.ini", "input.ini"]
    : [];
};

const assertContained = (root: string, target: string): void => {
  const relative = path.relative(root, target);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("User data path escapes the installation directory");
  }
};

const inspectPath = async (root: string, target: string): Promise<boolean> => {
  assertContained(root, target);
  const segments = path.relative(root, target).split(path.sep).filter(Boolean);
  let current = root;
  for (const segment of ["", ...segments]) {
    current = path.join(current, segment);
    try {
      const entry = await fs.lstat(current);
      if (entry.isSymbolicLink())
        throw new Error("Linked user data paths are not supported");
      if (!entry.isDirectory() && !entry.isFile())
        throw new Error("Unsupported user data entry");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  return true;
};

const copyEntry = async (
  sourceRoot: string,
  source: string,
  targetRoot: string,
  target: string
): Promise<void> => {
  if (!(await inspectPath(sourceRoot, source))) return;
  await inspectPath(targetRoot, target);
  const entry = await fs.lstat(source);
  if (entry.isDirectory()) {
    await fs.mkdir(target, { recursive: true });
    for (const name of await fs.readdir(source)) {
      await copyEntry(
        sourceRoot,
        path.join(source, name),
        targetRoot,
        path.join(target, name)
      );
    }
  } else {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  }
};

/** Copy user-owned files over package defaults, leaving the old data untouched. */
export const preservePortUserData = async (
  port: PortCatalogueEntry,
  previous: InstalledPort,
  staging: string,
  relativeExecutable: string,
  platform: NodeJS.Platform
): Promise<void> => {
  const sourceRoot = path.resolve(previous.installPath);
  const targetRoot = path.resolve(staging);
  const sourceDir = path.dirname(path.resolve(previous.executablePath));
  const targetExe = path.resolve(staging, relativeExecutable);
  const targetDir = path.dirname(targetExe);
  assertContained(sourceRoot, sourceDir);
  assertContained(targetRoot, targetExe);
  for (const entry of getPortPreservationPaths(port, platform)) {
    if (!isSafePreservationPath(entry))
      throw new Error("Invalid user data preservation path");
    const segments = entry.split(/[\\/]/);
    const source = path.join(sourceDir, ...segments);
    const target = path.join(targetDir, ...segments);
    const executableRelative = path.relative(target, targetExe);
    if (
      executableRelative === "" ||
      (!executableRelative.startsWith("..") &&
        !path.isAbsolute(executableRelative))
    ) {
      throw new Error("Preservation must not replace the executable");
    }
    await copyEntry(sourceRoot, source, targetRoot, target);
  }
};
