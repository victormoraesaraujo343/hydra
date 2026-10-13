import { QuestionIcon, StarFillIcon } from "@primer/octicons-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@renderer/components/badge/badge";
import { Link } from "@renderer/components/link/link";

import type { InstalledPort, PortCatalogueEntry } from "@types";

import "./port-item.scss";

/** 1234 -> "1.2k", 999 -> "999", 1500000 -> "1.5M". */
export function formatStars(stars: number): string {
  const compact = (value: number, suffix: string) => {
    const rounded = value.toFixed(1).replace(/\.0$/, "");
    return `${rounded}${suffix}`;
  };

  if (stars >= 1_000_000) return compact(stars / 1_000_000, "M");
  if (stars >= 1_000) return compact(stars / 1_000, "k");

  return String(stars);
}

export interface PortItemProps {
  port: PortCatalogueEntry;
  installed?: InstalledPort;
}

export const PortItem = memo(function PortItem({
  port,
  installed,
}: Readonly<PortItemProps>) {
  const { t } = useTranslation("ports");

  return (
    <article className="port-item">
      <Link to={`/port/${port.id}`} className="port-item__link">
        <div className="port-item__cover">
          {port.coverImageUrl ? (
            <>
              <img
                className="port-item__cover-backdrop"
                src={port.coverImageUrl}
                alt=""
                aria-hidden="true"
                loading="lazy"
                decoding="async"
              />
              <img
                className="port-item__cover-image"
                src={port.coverImageUrl}
                alt={port.title}
                loading="lazy"
                decoding="async"
              />
            </>
          ) : (
            <div className="port-item__cover-placeholder">
              <QuestionIcon size={24} />
              <span className="port-item__cover-title">{port.title}</span>
            </div>
          )}

          <span className="port-item__platform-chip">
            {t(`platform_${port.platform}`)}
          </span>
        </div>

        <div className="port-item__details">
          <span className="port-item__title" title={port.title}>
            {port.title}
          </span>

          <div className="port-item__badges">
            <Badge>{t(`status_${port.status}`)}</Badge>
            {port.tested && <Badge>{t("tested")}</Badge>}
            {installed && <Badge>{t("installed")}</Badge>}
          </div>

          {port.stats && (
            <span
              className="port-item__stars"
              title={t("stars", { count: port.stats.stars })}
            >
              <StarFillIcon size={12} />
              {formatStars(port.stats.stars)}
            </span>
          )}
        </div>
      </Link>
    </article>
  );
});
