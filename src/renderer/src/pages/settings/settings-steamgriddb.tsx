import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector, useToast } from "@renderer/hooks";
import { LinkExternalIcon } from "@primer/octicons-react";

const STEAMGRIDDB_KEY_URL =
  "https://www.steamgriddb.com/profile/preferences/api";

export function SettingsSteamGridDb() {
  const { t } = useTranslation("settings");
  const { showSuccessToast } = useToast();
  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const savedKey = userPreferences?.steamGridDbApiKey ?? "";
  const [value, setValue] = useState(savedKey);

  useEffect(() => {
    setValue(savedKey);
  }, [savedKey]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();

    const nextKey = value.trim() || null;
    updateUserPreferences({ steamGridDbApiKey: nextKey });
    showSuccessToast(t("changes_saved"));
  };

  return (
    <form onSubmit={handleSubmit}>
      <TextField
        label={t("steamgriddb_api_key")}
        type="password"
        value={value}
        autoComplete="off"
        onChange={(event) => setValue(event.target.value)}
        hint={t("steamgriddb_api_key_hint")}
        rightContent={
          <Button type="submit" disabled={value.trim() === savedKey}>
            {t("save_changes")}
          </Button>
        }
      />

      <Button
        type="button"
        theme="outline"
        onClick={() => window.electron.openExternal(STEAMGRIDDB_KEY_URL)}
      >
        <LinkExternalIcon />
        {t("steamgriddb_get_key")}
      </Button>
    </form>
  );
}
