import { demoContext, demoSearch, demoSections } from "./demo.ts";
import { validateCredentials } from "./links.ts";
import { CURATED, KINDS } from "./types.ts";
import type { Credentials, CuratedSection, RememberKind, RememberResponse, SearchGroup, Status } from "./types.ts";
export { CURATED, KINDS } from "./types.ts";
export type { Credentials, CuratedSection, RememberKind, RememberResponse, SearchGroup, Status } from "./types.ts";

export class HubError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "HubError";
    this.status = status;
  }
}

const wrongResponse = () => new HubError("This address did not return a Metaharness response. Check the hub URL, including its base path.");
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function parseSearchResults(text: string): SearchGroup[] {
  if (text.trim() === "No matches.") return [];
  const markers = [...text.matchAll(/^\[((?:self\/)?(?:profile|now|preferences|projects)\.md|journal-digest\.md|(?:note|journal) [^\]\r\n]+)\]\r?$/gm)];
  if (!markers.length || text.slice(0, markers[0].index).trim()) throw wrongResponse();
  const groups = new Map<string, string[]>();
  markers.forEach((marker, index) => {
    const item = text.slice(marker.index! + marker[0].length, markers[index + 1]?.index ?? text.length).trim();
    if (item) groups.set(marker[1], [...(groups.get(marker[1]) ?? []), item]);
  });
  return [...groups].map(([source, items]) => ({ source, items }));
}

export class HubClient {
  private credentials: Credentials;
  private fetcher: typeof fetch;
  private demoNotes: string[] = [];

  constructor(credentials: Credentials, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.credentials = { ...credentials };
    this.fetcher = fetcher;
  }

  private get demo() { return this.credentials.token === "demo"; }

  private async request(path: string, json: boolean, body?: unknown): Promise<unknown> {
    const credentials = validateCredentials(this.credentials);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      let response: Response;
      try {
        response = await this.fetcher(credentials.url + path, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            Authorization: `Bearer ${credentials.token}`,
            Accept: json ? "application/json" : "text/markdown",
            "X-Agent": "app",
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
        });
      } catch {
        throw new HubError(controller.signal.aborted
          ? "The hub took too long to respond. Check the address and your connection."
          : "Could not reach the hub. Check the URL, network connection, and whether the hub is running. HTTPS pages need an HTTPS hub.");
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new HubError(`Token rejected (${response.status}). Check your token in Settings.`, response.status);
        if (response.status === 404 || response.status === 405) throw new HubError("Hub route not found. Check the base URL and that your hub is up to date.", response.status);
        throw new HubError(`The hub returned an error (${response.status}). Try again shortly.`, response.status);
      }
      if (response.redirected) throw wrongResponse();
      const contentType = response.headers.get("content-type") ?? "";
      if (json ? !/^application\/json\b/i.test(contentType) : !/^text\/markdown\b/i.test(contentType)) throw wrongResponse();
      try {
        if (json) return await response.json();
        const text = await response.text();
        if (/^\s*(?:<!doctype\s+html|<html[\s>])/i.test(text)) throw wrongResponse();
        return text;
      } catch { throw wrongResponse(); }
    } finally { clearTimeout(timeout); }
  }

  async context(): Promise<string> {
    if (this.demo) return demoContext(this.demoNotes);
    return await this.request("/context", false) as string;
  }

  async section(name: CuratedSection): Promise<string> {
    if (!CURATED.includes(name)) throw new HubError("Choose one of the four curated memory sections.");
    if (this.demo) return demoSections[name];
    const body = await this.request("/mcp", true, {
      jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_section", arguments: { name } },
    });
    if (!isRecord(body) || body.jsonrpc !== "2.0" || body.id !== 1 || !isRecord(body.result)) throw wrongResponse();
    if (body.result.isError) throw new HubError("The hub could not read this section. Check that the hub is up to date.");
    const content = body.result.content;
    if (!Array.isArray(content) || content.length === 0 || content.some((part) => !isRecord(part) || part.type !== "text" || typeof part.text !== "string")) throw wrongResponse();
    return content.map((part) => part.text).join("\n");
  }

  async search(query: string): Promise<SearchGroup[]> {
    if (this.demo) return demoSearch(query, this.demoNotes);
    return parseSearchResults(await this.request(`/search?q=${encodeURIComponent(query)}`, false) as string);
  }

  async status(): Promise<Status> {
    if (this.demo) return { last_sync: null, pending_notes: this.demoNotes.length };
    const body = await this.request("/status", true);
    if (!isRecord(body) || !(body.last_sync === null || (typeof body.last_sync === "string" && Number.isFinite(Date.parse(body.last_sync)))) ||
        typeof body.pending_notes !== "number" || !Number.isInteger(body.pending_notes) || body.pending_notes < 0) throw wrongResponse();
    return { last_sync: body.last_sync as string | null, pending_notes: body.pending_notes };
  }

  async remember(text: string, kind: RememberKind): Promise<RememberResponse> {
    const clean = text.trim();
    if (!clean) throw new HubError("Write something to remember.");
    if (!KINDS.includes(kind)) throw new HubError("Choose a valid memory kind.");
    if (this.demo) {
      const normalized = clean.toLowerCase().replace(/\s+/g, " ");
      if (this.demoNotes.some((note) => note.toLowerCase().replace(/\s+/g, " ") === normalized)) return { result: "Already known." };
      this.demoNotes.push(clean);
      return { result: "Demo capture saved for this session. No note was sent to a hub." };
    }
    const body = await this.request("/remember", true, { text: clean, kind, source: "app" });
    if (!isRecord(body) || typeof body.result !== "string" || !body.result.trim()) throw wrongResponse();
    return { result: body.result };
  }
}
