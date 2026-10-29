import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { HubClient } from "../lib/api";
import type { Credentials } from "../lib/types";
import { clearCredentials, getCredentials, saveCredentials } from "../lib/storage";

type AppState = {
  credentials: Credentials;
  client: HubClient;
  ready: boolean;
  configError: string | null;
  configure: (value: Credentials) => Promise<void>;
  disconnect: () => Promise<void>;
  capture: boolean;
  openCapture: () => void;
  closeCapture: () => void;
  refreshKey: number;
  refresh: () => void;
  incoming: Credentials | null;
  setIncoming: (value: Credentials | null) => void;
};
const Context = createContext<AppState | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const [credentials, setCredentials] = useState<Credentials>({ url: "", token: "" });
  const [ready, setReady] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [capture, setCapture] = useState(false);
  const [incoming, setIncoming] = useState<Credentials | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const client = useMemo(() => new HubClient(credentials), [credentials]);
  useEffect(() => {
    let active = true;
    getCredentials().then(value => { if (active) setCredentials(value); })
      .catch(() => { if (active) setConfigError("Could not read saved settings. Enter your connection again."); })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  async function configure(value: Credentials) {
    await saveCredentials(value);
    setCredentials(value);
    setConfigError(null);
    setIncoming(null);
    setCapture(false);
    setRefreshKey(key => key + 1);
  }
  async function disconnect() {
    await clearCredentials();
    setCredentials({ url: "", token: "" });
    setIncoming(null);
    setCapture(false);
    setRefreshKey(key => key + 1);
  }
  const refresh = useCallback(() => setRefreshKey(key => key + 1), []);
  return <Context.Provider value={{ credentials, client, ready, configError, configure, disconnect,
    capture, openCapture: () => setCapture(true), closeCapture: () => setCapture(false),
    refreshKey, refresh, incoming, setIncoming }}>{children}</Context.Provider>;
}
export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error("AppProvider is missing.");
  return value;
}
