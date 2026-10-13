import { registerEvent } from "../register-event";
import { createCustomGame } from "@main/services/library-custom-game";

const addCustomGameToLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  title: string,
  executablePath: string,
  iconUrl?: string,
  logoImageUrl?: string,
  libraryHeroImageUrl?: string
) => {
  return createCustomGame({
    title,
    executablePath,
    iconUrl,
    logoImageUrl,
    libraryHeroImageUrl,
  });
};

registerEvent("addCustomGameToLibrary", addCustomGameToLibrary);
