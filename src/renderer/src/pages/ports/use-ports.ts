import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { InstalledPort, PortErrorCode, PortsCatalogue } from "@types";

export function usePorts() {
  const [catalogue, setCatalogue] = useState<PortsCatalogue | null>(null);
  const [installed, setInstalled] = useState<InstalledPort[]>([]);
  const [error, setError] = useState<PortErrorCode | null>(null);
  const [loading, setLoading] = useState(true);

  const requestIdRef = useRef(0);

  const load = useCallback(async (force = false) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);

    try {
      const [catalogueResult, installedPorts] = await Promise.all([
        window.electron.getPortsCatalogue(force),
        window.electron.getInstalledPorts(),
      ]);

      if (requestId !== requestIdRef.current) return;

      setInstalled(installedPorts);

      if (catalogueResult.ok) {
        setCatalogue(catalogueResult.data);
        setError(null);
      } else {
        setError(catalogueResult.error);
      }
    } catch {
      if (requestId !== requestIdRef.current) return;
      setError("catalogue_unavailable");
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const installedById = useMemo(() => {
    return installed.reduce<Record<string, InstalledPort>>((acc, port) => {
      acc[port.portId] = port;
      return acc;
    }, {});
  }, [installed]);

  const reload = useCallback(() => load(true), [load]);

  return {
    catalogue,
    installed,
    installedById,
    error,
    loading,
    reload,
  };
}
