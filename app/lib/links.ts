import type { Credentials } from "./types.ts";

export function validateCredentials(value: Credentials): Credentials {
  if (!value.token) throw new Error("Enter your hub token, or use demo for sample data.");
  if (/\s/.test(value.token)) throw new Error("Paste the token without spaces or line breaks.");
  if (value.token === "demo") return { url: "", token: "demo" };
  let parsed: URL;
  try { parsed = new URL(value.url.trim()); }
  catch { throw new Error("Enter a valid HTTP or HTTPS hub URL."); }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname ||
      parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Use the hub base URL without credentials, a query, or a fragment.");
  }
  return { url: parsed.href.replace(/\/+$/, ""), token: value.token };
}

/** Never put the original link into an error: it contains a bearer credential. */
export function parseConnectLink(raw: string): Credentials {
  const invalid = () => new Error("Invalid connection link. Paste your hub URL and token in Settings.");
  let link: URL;
  try {
    if (/%(?![\da-f]{2})/i.test(raw)) throw invalid();
    link = new URL(raw);
  } catch { throw invalid(); }
  if (link.protocol !== "metaharness:" || link.hostname !== "connect" ||
      (link.pathname !== "" && link.pathname !== "/") || link.username ||
      link.password || link.port || link.hash ||
      link.searchParams.getAll("url").length !== 1 ||
      link.searchParams.getAll("token").length !== 1 ||
      [...link.searchParams.keys()].some((key) => key !== "url" && key !== "token")) throw invalid();
  const url = link.searchParams.get("url") ?? "";
  const token = link.searchParams.get("token") ?? "";
  if (!url || !token) throw invalid();
  try { return validateCredentials({ url, token }); }
  catch { throw invalid(); }
}
