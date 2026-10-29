import { parseConnectLink } from "../../lib/links";
import { receiveConnection } from "../pending-connection";

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (!/^metaharness:/i.test(path)) {
    // Do not let unsupported URL formats place credentials in navigation state.
    if (/[?#]/.test(path) || !path.startsWith("/") || path.length > 256) {
      receiveConnection(null);
      return "/connect?invalid=1";
    }
    return path;
  }
  try {
    receiveConnection(parseConnectLink(path));
    // The credential is held only in memory until saved, never in router state.
    return "/connect";
  } catch {
    receiveConnection(null);
    return "/connect?invalid=1";
  }
}
