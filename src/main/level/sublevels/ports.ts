import { db } from "../level";
import { levelKeys } from "./keys";
import type {
  InstalledPort,
  PortCoversCacheEntry,
  PortsCatalogue,
} from "@types";

export const portsSublevel = db.sublevel<string, InstalledPort>(
  levelKeys.ports,
  {
    valueEncoding: "json",
  }
);

export const portsCatalogueCacheSublevel = db.sublevel<string, PortsCatalogue>(
  levelKeys.portsCatalogueCache,
  { valueEncoding: "json" }
);

export const portsCoversCacheSublevel = db.sublevel<
  string,
  PortCoversCacheEntry
>(levelKeys.portsCoversCache, { valueEncoding: "json" });
