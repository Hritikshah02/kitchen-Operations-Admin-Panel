"use client";

import { useCallback, useEffect, useState } from "react";
import { apiJson, messageOf } from "./api";

/**
 * Loads JSON from the API. `path = null` skips loading; call `reload()` or change `refreshKey`
 * to fetch again (refreshKey lets a parent refresh a child's data without touching the URL).
 */
export function useResource<T>(path: string | null, refreshKey: string | number = "") {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(path !== null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    apiJson<T>(path)
      .then((result) => { if (!cancelled) { setData(result); setError(""); } })
      .catch((caught) => { if (!cancelled) setError(messageOf(caught, "Could not load data.")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path, version, refreshKey]);

  return { data, error, loading, reload };
}
