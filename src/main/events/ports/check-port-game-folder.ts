import type { PortGameCheckResult, PortResult } from "@types";
import { registerEvent } from "../register-event";
import { findPort } from "@main/services/ports/ports-catalogue";
import { checkPortGameFolder } from "@main/services/ports/port-game-check";

const checkPortGameFolderHandler = async (
  _event: Electron.IpcMainInvokeEvent,
  portId: string,
  targetPath: string
): Promise<PortResult<PortGameCheckResult>> => {
  const port = await findPort(portId);
  if (!port) return { ok: false, error: "port_not_found" };

  if (typeof targetPath !== "string" || targetPath.trim().length === 0) {
    return {
      ok: true,
      data: { ok: false, titleId: null, missingFiles: [], reason: "not_found" },
    };
  }

  return {
    ok: true,
    data: await checkPortGameFolder(port.game, targetPath),
  };
};

registerEvent("checkPortGameFolder", checkPortGameFolderHandler);
