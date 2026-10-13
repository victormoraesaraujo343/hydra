import { StarFillIcon } from "@primer/octicons-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { Badge } from "@renderer/components/badge/badge";
import { Button } from "@renderer/components/button/button";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useLibrary } from "@renderer/hooks";

import type {
  LocalizedList,
  LocalizedText,
  PortErrorCode,
  PortGameCheckResult,
  PortInstallProgress,
  PortRelease,
} from "@types";

import { formatStars } from "./port-item";
import { usePorts } from "./use-ports";

import "./port-details.scss";

type CheckFormat = "folder" | "iso";

/** Picks the text for the current language, then its base language, then "en". */
const pickText = (text: LocalizedText, language: string): string =>
  text[language] ?? text[language.split("-")[0]] ?? text.en;

const pickList = (list: LocalizedList, language: string): string[] =>
  list[language] ?? list[language.split("-")[0]] ?? list.en;

export default function PortDetails() {
  const { t, i18n } = useTranslation("ports");
  const { portId = "" } = useParams();
  const navigate = useNavigate();
  const { updateLibrary } = useLibrary();

  const {
    catalogue,
    installedById,
    error: catalogueError,
    loading,
    reload,
  } = usePorts();

  const port = catalogue?.ports.find((entry) => entry.id === portId);
  const installed = installedById[portId];

  const [latestRelease, setLatestRelease] = useState<PortRelease | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PortInstallProgress | null>(null);
  const [actionError, setActionError] = useState<PortErrorCode | null>(null);
  const [confirmingUninstall, setConfirmingUninstall] = useState(false);
  const [checkResult, setCheckResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  useEffect(() => {
    const unsubscribe = window.electron.onPortInstallProgress((payload) => {
      if (payload.portId !== portId) return;
      setProgress(payload);
    });

    return unsubscribe;
  }, [portId]);

  useEffect(() => {
    let cancelled = false;

    window.electron
      .getPortLatestRelease(portId)
      .then((result) => {
        if (!cancelled && result.ok) setLatestRelease(result.data);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [portId]);

  if (!port) {
    return (
      <div className="port-details port-details--state">
        {catalogueError ? (
          <>
            <p>{t("catalogue_unavailable")}</p>
            <Button theme="outline" onClick={reload} disabled={loading}>
              {t("retry")}
            </Button>
          </>
        ) : loading ? (
          <p>{t("loading", { ns: "header" })}</p>
        ) : (
          <p>{t("error_port_not_found")}</p>
        )}
      </div>
    );
  }

  const language = i18n.language;
  const heroImage = port.heroImageUrl ?? port.coverImageUrl;
  const description = pickText(port.description, language);
  const notes = port.game.notes ? pickText(port.game.notes, language) : null;
  const requirements = port.requirements
    ? pickList(port.requirements, language)
    : [];
  const setupHint = port.setupHint ? pickText(port.setupHint, language) : null;

  const hasUpdate = Boolean(
    installed && latestRelease && latestRelease.tag !== installed.version
  );

  const checkFormats: CheckFormat[] =
    port.game.format === "folder"
      ? ["folder"]
      : port.game.format === "iso"
        ? ["iso"]
        : ["folder", "iso"];

  const updatedDate =
    port.stats?.pushedAt && !Number.isNaN(Date.parse(port.stats.pushedAt))
      ? new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(
          new Date(port.stats.pushedAt)
        )
      : null;

  const describeCheck = (check: PortGameCheckResult): string => {
    switch (check.reason) {
      case "ok":
        return t("check_ok", {
          titleId: check.titleId ? ` (${check.titleId})` : "",
        });
      case "missing_files":
        return t("check_missing_files", {
          files: check.missingFiles.join(", "),
        });
      case "wrong_title_id":
        return t("check_wrong_title_id", { titleId: check.titleId ?? "" });
      case "not_found":
        return t("check_not_found");
      case "wrong_format":
        return t("check_wrong_format");
    }
  };

  const runInstall = async () => {
    setBusy(true);
    setActionError(null);
    setCheckResult(null);
    setProgress(null);

    try {
      const result = await window.electron.installPort(port.id);

      if (!result.ok) {
        setActionError(result.error);
        return;
      }

      await updateLibrary();
      await reload();
    } catch {
      setActionError("download_failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const runUninstall = async () => {
    setBusy(true);
    setActionError(null);
    setConfirmingUninstall(false);

    try {
      const result = await window.electron.uninstallPort(port.id);

      if (!result.ok) {
        setActionError(result.error);
        return;
      }

      await updateLibrary();
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const runCheck = async (format: CheckFormat) => {
    const dialogResult = await window.electron.showOpenDialog(
      format === "folder"
        ? { properties: ["openDirectory"] }
        : {
            properties: ["openFile"],
            filters: [{ name: "ISO", extensions: ["iso"] }],
          }
    );

    if (dialogResult.canceled || dialogResult.filePaths.length === 0) return;

    setBusy(true);
    setActionError(null);
    setCheckResult(null);

    try {
      const result = await window.electron.checkPortGameFolder(
        port.id,
        dialogResult.filePaths[0]
      );

      if (!result.ok) {
        setActionError(result.error);
        return;
      }

      setCheckResult({
        ok: result.data.ok,
        text: describeCheck(result.data),
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePlay = () => {
    if (!installed) return;

    navigate(
      buildGameDetailsPath({
        shop: "custom",
        objectId: installed.gameObjectId,
        title: port.title,
      })
    );
  };

  const renderProgress = () => {
    if (!busy || !progress) return null;

    let label: string | null = null;
    let showBar = false;
    let percent = 0;

    switch (progress.phase) {
      case "resolving":
        label = t("installing_resolving");
        break;
      case "downloading":
        if (progress.total && progress.total > 0) {
          percent = Math.min(
            100,
            Math.round(((progress.loaded ?? 0) / progress.total) * 100)
          );
          label = t("installing_downloading", { percent });
          showBar = true;
        } else {
          label = t("downloading", { ns: "library" });
        }
        break;
      case "verifying":
        label = t("installing_verifying");
        break;
      case "extracting":
        label = t("installing_extracting");
        break;
      case "finalizing":
        label = t("installing_finalizing");
        break;
      case "done":
      case "error":
        return null;
    }

    if (!label) return null;

    return (
      <div className="port-details__progress">
        <span>{label}</span>
        {showBar && (
          <progress
            className="port-details__progress-bar"
            max={100}
            value={percent}
            aria-label={label}
          />
        )}
      </div>
    );
  };

  return (
    <div className="port-details">
      <div className="port-details__hero">
        {heroImage && (
          <img
            className="port-details__hero-image"
            src={heroImage}
            alt=""
            aria-hidden="true"
          />
        )}
        <div className="port-details__hero-overlay" />
      </div>

      <div className="port-details__body">
        <header className="port-details__header">
          {port.coverImageUrl && (
            <img
              className="port-details__cover"
              src={port.coverImageUrl}
              alt={port.title}
            />
          )}

          <div className="port-details__heading">
            <h1 className="port-details__title">{port.title}</h1>

            {port.authors.length > 0 && (
              <p className="port-details__authors">
                {t("by_authors", { authors: port.authors.join(", ") })}
              </p>
            )}

            <div className="port-details__badges">
              <Badge>{t(`platform_${port.platform}`)}</Badge>
              <Badge>{t(`status_${port.status}`)}</Badge>
              {port.tested && <Badge>{t("tested")}</Badge>}
              {installed && <Badge>{t("installed")}</Badge>}
            </div>

            <div className="port-details__meta">
              {port.stats && (
                <span
                  className="port-details__stars"
                  title={t("stars", { count: port.stats.stars })}
                >
                  <StarFillIcon size={12} />
                  {formatStars(port.stats.stars)}
                </span>
              )}
              {updatedDate && (
                <span>{t("updated_at", { date: updatedDate })}</span>
              )}
            </div>

            <div>
              <Button
                theme="outline"
                onClick={() =>
                  window.electron.openExternal(
                    `https://github.com/${port.repo}`
                  )
                }
              >
                {t("view_project")}
              </Button>
            </div>
          </div>
        </header>

        <section className="port-details__section">
          <p className="port-details__description">{description}</p>
        </section>

        <section className="port-details__card">
          <h2 className="port-details__card-title">{t("you_need")}</h2>
          <p className="port-details__notice">{t("own_copy_notice")}</p>
          <ul className="port-details__list">
            <li>{t(`game_format_${port.game.format}`)}</li>
            {port.game.requiredFiles.length > 0 && (
              <li>
                {t("required_files", {
                  files: port.game.requiredFiles.join(", "),
                })}
              </li>
            )}
            {port.game.titleIds.length > 0 && (
              <li>{t("title_ids", { ids: port.game.titleIds.join(", ") })}</li>
            )}
            {notes && <li>{notes}</li>}
          </ul>

          {requirements.length > 0 && (
            <>
              <h3 className="port-details__subtitle">{t("requirements")}</h3>
              <ul className="port-details__list">
                {requirements.map((requirement) => (
                  <li key={requirement}>{requirement}</li>
                ))}
              </ul>
            </>
          )}
        </section>

        {setupHint && (
          <section className="port-details__card">
            <h2 className="port-details__card-title">{t("setup_hint")}</h2>
            <p className="port-details__description">{setupHint}</p>
          </section>
        )}

        <section className="port-details__card">
          <div className="port-details__actions">
            {!installed && (
              <Button onClick={runInstall} disabled={busy}>
                {t("install")}
              </Button>
            )}

            {installed && hasUpdate && latestRelease && (
              <Button onClick={runInstall} disabled={busy}>
                {t("update", { version: latestRelease.tag })}
              </Button>
            )}

            {installed && (
              <Button
                theme={hasUpdate ? "outline" : "primary"}
                onClick={handlePlay}
                disabled={busy}
              >
                {t("play")}
              </Button>
            )}
          </div>

          {renderProgress()}

          {installed && (
            <p className="port-details__version">
              {t("version_installed", { version: installed.version })}
            </p>
          )}

          <div className="port-details__actions">
            {checkFormats.map((format) => (
              <Button
                key={format}
                theme="outline"
                onClick={() => runCheck(format)}
                disabled={busy}
              >
                {format === "folder" ? t("check_game") : t("game_format_iso")}
              </Button>
            ))}
          </div>

          {checkResult && (
            <p
              className={
                checkResult.ok
                  ? "port-details__result port-details__result--ok"
                  : "port-details__result"
              }
            >
              {checkResult.text}
            </p>
          )}

          {actionError && (
            <p className="port-details__result port-details__result--error">
              {t(`error_${actionError}`)}
            </p>
          )}

          {installed && (
            <div className="port-details__actions">
              {confirmingUninstall ? (
                <>
                  <Button theme="danger" onClick={runUninstall} disabled={busy}>
                    {t("confirm", { ns: "sidebar" })}
                  </Button>
                  <Button
                    theme="outline"
                    onClick={() => setConfirmingUninstall(false)}
                    disabled={busy}
                  >
                    {t("cancel", { ns: "sidebar" })}
                  </Button>
                </>
              ) : (
                <Button
                  theme="outline"
                  onClick={() => setConfirmingUninstall(true)}
                  disabled={busy}
                >
                  {t("uninstall")}
                </Button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
