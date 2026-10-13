import type { PortResult } from "@types";
import { registerEvent } from "../register-event";
import { uninstallPort } from "@main/services/ports/port-installer";

const uninstallPortHandler = async (
  _event: Electron.IpcMainInvokeEvent,
  portId: string
): Promise<PortResult<null>> => uninstallPort(portId);

registerEvent("uninstallPort", uninstallPortHandler);
