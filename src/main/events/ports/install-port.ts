import type { InstalledPort, PortResult } from "@types";
import { registerEvent } from "../register-event";
import { installPort } from "@main/services/ports/port-installer";

const installPortHandler = async (
  _event: Electron.IpcMainInvokeEvent,
  portId: string
): Promise<PortResult<InstalledPort>> => installPort(portId);

registerEvent("installPort", installPortHandler);
