import { parseConnectLink } from "../../lib/links";
import { receiveConnection } from "../pending-connection";

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (!/^metaharness:/i.test(path)) return path;
  try {
    receiveConnection(parseConnectLink(path));
    // The credential is held only in memory until saved, never in router state.
    return "/connect";
  } catch {
    receiveConnection(null);
    return "/connect?invalid=1";
  }
}
