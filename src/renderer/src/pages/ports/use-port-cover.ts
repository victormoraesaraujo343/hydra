import { useCallback, useEffect, useState } from "react";

import type { PortCovers, PortErrorCode } from "@types";

/** Results for this session, by port id. Only successful lookups are kept. */
const sessionCache = new Map<string, PortCovers>();

const LOOKUP_ROOT_MARGIN = "200px";

export interface PortCoverState {
  cover: string | null;
  hero: string | null;
  error: PortErrorCode | null;
  /** Attach to the element that should trigger the lookup when it nears the viewport. */
  ref: (node: HTMLElement | null) => void;
}

/**
 * Looks up SteamGridDB art for a port once its element is near the viewport.
 * Pass enabled=false when the catalogue already has the art.
 */
export function usePortCover(
  port: { id: string } | undefined,
  enabled: boolean
): PortCoverState {
  const portId = port?.id;
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<{
    covers: PortCovers | null;
    error: PortErrorCode | null;
  }>({ covers: null, error: null });

  const ref = useCallback((node: HTMLElement | null) => setElement(node), []);

  useEffect(() => {
    if (!enabled || !portId || visible || !element) return;

    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: LOOKUP_ROOT_MARGIN }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, portId, element, visible]);

  useEffect(() => {
    if (!enabled || !portId || !visible) return;

    const cached = sessionCache.get(portId);
    if (cached) {
      setState({ covers: cached, error: null });
      return;
    }

    let cancelled = false;

    window.electron
      .getPortCover(portId)
      .then((result) => {
        if (result.ok) {
          sessionCache.set(portId, result.data);
          if (!cancelled) setState({ covers: result.data, error: null });
          return;
        }

        if (!cancelled) setState({ covers: null, error: result.error });
      })
      .catch(() => {
        if (!cancelled) setState({ covers: null, error: null });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, portId, visible]);

  return {
    cover: state.covers?.cover ?? null,
    hero: state.covers?.hero ?? null,
    error: state.error,
    ref,
  };
}
