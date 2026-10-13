import { registerEvent } from "../register-event";
import { getInstalledPorts } from "@main/services/ports/port-installer";

const getInstalledPortsHandler = async () => getInstalledPorts();

registerEvent("getInstalledPorts", getInstalledPortsHandler);
