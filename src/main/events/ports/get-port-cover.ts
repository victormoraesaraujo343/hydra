import type { PortCovers, PortResult } from "@types";
import { registerEvent } from "../register-event";
import { getPortCover } from "@main/services/ports/port-covers";

const getPortCoverHandler = async (
  _event: Electron.IpcMainInvokeEvent,
  portId: string
): Promise<PortResult<PortCovers>> => getPortCover(portId);

registerEvent("getPortCover", getPortCoverHandler);
