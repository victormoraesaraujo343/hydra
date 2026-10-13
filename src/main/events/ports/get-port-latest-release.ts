import type { PortRelease, PortResult } from "@types";
import { registerEvent } from "../register-event";
import { findPort } from "@main/services/ports/ports-catalogue";
import { fetchPortRelease } from "@main/services/ports/port-release";

const getPortLatestRelease = async (
  _event: Electron.IpcMainInvokeEvent,
  portId: string
): Promise<PortResult<PortRelease>> => {
  const port = await findPort(portId);
  if (!port) return { ok: false, error: "port_not_found" };

  return fetchPortRelease(port);
};

registerEvent("getPortLatestRelease", getPortLatestRelease);
