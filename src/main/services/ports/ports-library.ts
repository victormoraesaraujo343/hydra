import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import { createCustomGame } from "@main/services/library-custom-game";
import type { PortCatalogueEntry } from "@types";

const readCustomGame = async (objectId: string) => {
  try {
    const game = await gamesSublevel.get(levelKeys.game("custom", objectId));
    return game ?? null;
  } catch (error) {
    if (error instanceof Error && error.name === "NotFoundError") {
      return null;
    }
    throw error;
  }
};

/**
 * Adds the port to the library as a custom game, or updates the existing
 * library game in place (keeping playtime, favorites and every other field)
 * when it still exists and is not deleted. Returns the library objectId.
 */
export const upsertPortLibraryGame = async (
  port: PortCatalogueEntry,
  executablePath: string,
  existingObjectId: string | null
): Promise<string> => {
  if (existingObjectId) {
    const existing = await readCustomGame(existingObjectId);

    if (existing && !existing.isDeleted) {
      await gamesSublevel.put(levelKeys.game("custom", existingObjectId), {
        ...existing,
        executablePath,
        executablePathUpdatedAt: new Date(),
      });

      return existingObjectId;
    }
  }

  const game = await createCustomGame({
    title: port.title,
    executablePath,
    iconUrl: port.coverImageUrl,
    libraryHeroImageUrl: port.heroImageUrl,
  });

  return game.objectId;
};

/**
 * Removes the port's custom game and its shop assets from the library.
 * Missing keys are ignored (LevelDB del is a no-op for absent keys).
 */
export const removePortLibraryGame = async (
  objectId: string
): Promise<void> => {
  const gameKey = levelKeys.game("custom", objectId);

  await gamesSublevel.del(gameKey);
  await gamesShopAssetsSublevel.del(gameKey);
};
