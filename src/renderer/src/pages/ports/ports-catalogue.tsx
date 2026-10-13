import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

import { Button } from "@renderer/components/button/button";
import { CheckboxField } from "@renderer/components/checkbox-field/checkbox-field";
import { SelectField } from "@renderer/components/select-field/select-field";
import { useAppSelector, useFormat } from "@renderer/hooks";
import { CatalogueModeToggle } from "@renderer/pages/catalogue/catalogue-mode-toggle";

import type { PortCatalogueEntry, PortPlatform, PortStatus } from "@types";

import { PortItem } from "./port-item";
import { usePorts } from "./use-ports";

import "./ports-catalogue.scss";

type PortSortValue = "most_supported" | "recently_updated" | "title";

const PORT_STATUSES: PortStatus[] = ["playable", "partial", "experimental"];
const SKELETON_COUNT = 12;

const sortPorts = (
  ports: PortCatalogueEntry[],
  sort: PortSortValue
): PortCatalogueEntry[] => {
  const sorted = [...ports];

  switch (sort) {
    case "most_supported":
      // Null stats sort last.
      return sorted.sort(
        (a, b) => (b.stats?.stars ?? -1) - (a.stats?.stars ?? -1)
      );
    case "recently_updated":
      // ISO dates: lexicographic order is chronological. Null sorts last.
      return sorted.sort((a, b) =>
        (b.stats?.pushedAt ?? "").localeCompare(a.stats?.pushedAt ?? "")
      );
    case "title":
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
  }
};

/**
 * The catalogue page in Ports mode. Reuses the catalogue page layout (header
 * row, card grid, sidebar with the mode toggle) with the ports data.
 */
export function PortsCatalogue() {
  const { t } = useTranslation("ports");
  const { formatNumber } = useFormat();

  const titleFilter = useAppSelector(
    (state) => state.catalogueSearch.filters.title
  );

  const { catalogue, installedById, error, loading, reload } = usePorts();

  const [platform, setPlatform] = useState<PortPlatform | "">("");
  const [status, setStatus] = useState<PortStatus | "">("");
  const [testedOnly, setTestedOnly] = useState(false);
  const [sort, setSort] = useState<PortSortValue>("most_supported");

  const platformOptions = useMemo(() => {
    const platforms = new Set<PortPlatform>(
      catalogue?.ports.map((port) => port.platform) ?? []
    );

    return [...platforms]
      .map((value) => ({
        key: value,
        value,
        label: t(`platform_${value}`),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [catalogue, t]);

  const visiblePorts = useMemo(() => {
    const query = titleFilter.trim().toLowerCase();

    const filtered = (catalogue?.ports ?? []).filter(
      (port) =>
        (!query || port.title.toLowerCase().includes(query)) &&
        (!platform || port.platform === platform) &&
        (!status || port.status === status) &&
        (!testedOnly || port.tested)
    );

    return sortPorts(filtered, sort);
  }, [catalogue, titleFilter, platform, status, testedOnly, sort]);

  const sortOptions = [
    {
      key: "most_supported",
      value: "most_supported",
      label: t("sort_most_supported"),
    },
    {
      key: "recently_updated",
      value: "recently_updated",
      label: t("sort_recently_updated"),
    },
    { key: "title", value: "title", label: t("sort_title") },
  ];

  const statusOptions = [
    { key: "all", value: "", label: t("filter_status") },
    ...PORT_STATUSES.map((value) => ({
      key: value,
      value,
      label: t(`status_${value}`),
    })),
  ];

  const platformSelectOptions = [
    { key: "all", value: "", label: t("filter_platform") },
    ...platformOptions,
  ];

  return (
    <div className="catalogue">
      <div className="catalogue__header">
        <div className="catalogue__header-row">
          <div className="catalogue__header-summary">
            <span className="catalogue__result-count">
              {t("result_count", {
                ns: "catalogue",
                resultCount: formatNumber(visiblePorts.length),
              })}
            </span>
            <span className="catalogue__filters-hint">{t("subtitle")}</span>
          </div>

          <div className="catalogue__sort-inline">
            <span className="catalogue__sort-label">
              {t("sort_by", { ns: "catalogue" })}
            </span>
            <SelectField
              theme="dark"
              className="catalogue__sort-select"
              value={sort}
              options={sortOptions}
              onChange={(event) => setSort(event.target.value as PortSortValue)}
            />
          </div>
        </div>
      </div>

      <div className="catalogue__content">
        <div className="catalogue__games-container catalogue__games-container--classics">
          <div className="ports-catalogue__filters">
            <SelectField
              theme="dark"
              className="ports-catalogue__select"
              value={platform}
              options={platformSelectOptions}
              onChange={(event) =>
                setPlatform(event.target.value as PortPlatform | "")
              }
            />

            <SelectField
              theme="dark"
              className="ports-catalogue__select"
              value={status}
              options={statusOptions}
              onChange={(event) =>
                setStatus(event.target.value as PortStatus | "")
              }
            />

            <CheckboxField
              label={t("filter_tested_only")}
              checked={testedOnly}
              onChange={(event) => setTestedOnly(event.target.checked)}
            />
          </div>

          {error ? (
            <div className="ports-catalogue__state">
              <p>{t("catalogue_unavailable")}</p>
              <Button theme="outline" onClick={reload} disabled={loading}>
                {t("retry")}
              </Button>
            </div>
          ) : loading && !catalogue ? (
            <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
              {Array.from({ length: SKELETON_COUNT }).map((_, index) => (
                <Skeleton
                  key={index}
                  className="catalogue__skeleton catalogue__skeleton--classics"
                />
              ))}
            </SkeletonTheme>
          ) : visiblePorts.length === 0 ? (
            <p className="ports-catalogue__state">{t("empty")}</p>
          ) : (
            visiblePorts.map((port) => (
              <PortItem
                key={port.id}
                port={port}
                installed={installedById[port.id]}
              />
            ))
          )}
        </div>

        <div className="catalogue__filters-container">
          <div className="catalogue__filters-sections">
            <CatalogueModeToggle />
          </div>
        </div>
      </div>
    </div>
  );
}
