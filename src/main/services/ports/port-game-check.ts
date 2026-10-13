import fs from "node:fs";
import path from "node:path";

import { parseParamSfo } from "../emulators/param-sfo.js";
import { normalize } from "../emulators/sku-normalize.js";
import type {
  PortGameCheckResult,
  PortGameRequirement,
} from "../../../types/ports.types.js";

/** Where a PS4/PS3 game keeps its PARAM.SFO, in lookup order. */
const SFO_CANDIDATES = ["sce_sys/param.sfo", "PS3_GAME/PARAM.SFO", "PARAM.SFO"];

const pathExists = async (target: string): Promise<boolean> => {
  try {
    await fs.promises.access(target);
    return true;
  } catch {
    return false;
  }
};

const readTitleId = async (folder: string): Promise<string | null> => {
  for (const candidate of SFO_CANDIDATES) {
    const sfoPath = path.join(folder, candidate);
    if (!(await pathExists(sfoPath))) continue;
    try {
      const data = await fs.promises.readFile(sfoPath);
      return parseParamSfo(data);
    } catch {
      return null;
    }
  }
  return null;
};

const fail = (
  reason: PortGameCheckResult["reason"],
  titleId: string | null = null,
  missingFiles: string[] = []
): PortGameCheckResult => ({ ok: false, titleId, missingFiles, reason });

/**
 * Checks that a user-picked game path matches what a port needs: the right
 * format (folder or ISO), the required files, and the expected title ID when
 * a PARAM.SFO can be read. Reads the filesystem only; never modifies it.
 */
export const checkPortGameFolder = async (
  requirement: PortGameRequirement,
  targetPath: string
): Promise<PortGameCheckResult> => {
  const stats = await fs.promises.stat(targetPath).catch(() => null);
  if (!stats) return fail("not_found");

  if (stats.isFile()) {
    const isIso = path.extname(targetPath).toLowerCase() === ".iso";
    const acceptsIso =
      requirement.format === "iso" || requirement.format === "folder-or-iso";
    return isIso && acceptsIso
      ? { ok: true, titleId: null, missingFiles: [], reason: "ok" }
      : fail("wrong_format");
  }

  if (!stats.isDirectory() || requirement.format === "iso") {
    return fail("wrong_format");
  }

  const titleId = await readTitleId(targetPath);

  const missingFiles: string[] = [];
  for (const entry of requirement.requiredFiles) {
    if (!(await pathExists(path.join(targetPath, entry)))) {
      missingFiles.push(entry);
    }
  }
  if (missingFiles.length > 0) {
    return fail("missing_files", titleId, missingFiles);
  }

  if (titleId && requirement.titleIds.length > 0) {
    const expected = requirement.titleIds.map(normalize);
    if (!expected.includes(normalize(titleId))) {
      return fail("wrong_title_id", titleId);
    }
  }

  return { ok: true, titleId, missingFiles: [], reason: "ok" };
};
