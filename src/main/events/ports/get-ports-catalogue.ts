import { registerEvent } from "../register-event";
import { getPortsCatalogue } from "@main/services/ports/ports-catalogue";

const getPortsCatalogueHandler = async (
  _event: Electron.IpcMainInvokeEvent,
  forceRefresh?: boolean
) => getPortsCatalogue(forceRefresh === true);

registerEvent("getPortsCatalogue", getPortsCatalogueHandler);
