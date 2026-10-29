import { createDemoNotes, demoContext, demoSearch, demoSections, type DemoNote } from "./demo.ts";
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

const wrongResponse = () => new HubError("Not a Metaharness hub. Check the base URL.");
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export const MAX_NOTE_LENGTH = 16_000;
export const MAX_QUERY_LENGTH = 512;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

async function readBoundedResponse(response: Response): Promise<string> {
  const tooLarge = () => new HubError("Hub response is too large. Reduce the shared context and retry.");
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw tooLarge();
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw tooLarge(); }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}

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
  private demoNotes: DemoNote[] = [];
  private demoSampleNotes = createDemoNotes();

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
          referrerPolicy: "no-referrer",
          redirect: "error",
        });
      } catch {
        throw new HubError(controller.signal.aborted
          ? "Hub timed out. Check the URL and connection."
          : "Hub unreachable. Check the URL and connection.");
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new HubError(`${response.status} — Token rejected. Check your token.`, response.status);
        if (response.status === 404 || response.status === 405) throw new HubError(`${response.status} — Hub route not found. Check the base URL.`, response.status);
        throw new HubError(`${response.status} — Hub request failed. Try again.`, response.status);
      }
      if (response.redirected) throw wrongResponse();
      const contentType = response.headers.get("content-type") ?? "";
      if (json ? !/^application\/json\b/i.test(contentType) : !/^text\/markdown\b/i.test(contentType)) throw wrongResponse();
      try {
        const text = await readBoundedResponse(response);
        if (json) return JSON.parse(text);
        if (/^\s*(?:<!doctype\s+html|<html[\s>])/i.test(text)) throw wrongResponse();
        return text;
      } catch (error) { if (error instanceof HubError) throw error; throw wrongResponse(); }
    } finally { clearTimeout(timeout); }
  }

  async context(): Promise<string> {
    if (this.demo) return demoContext([...this.demoSampleNotes, ...this.demoNotes]);
    return await this.request("/context", false) as string;
  }

  async section(name: CuratedSection): Promise<string> {
    if (!CURATED.includes(name)) throw new HubError("Choose one of the four curated memory sections.");
    if (this.demo) return demoSections[name];
    const body = await this.request("/mcp", true, {
      jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_section", arguments: { name } },
    });
    if (!isRecord(body) || body.jsonrpc !== "2.0" || body.id !== 1 || !isRecord(body.result)) throw wrongResponse();
    if (body.result.isError) throw new HubError("Section could not be read. Update the hub and retry.");
    const content = body.result.content;
    if (!Array.isArray(content) || content.length === 0 || content.some((part) => !isRecord(part) || part.type !== "text" || typeof part.text !== "string")) throw wrongResponse();
    return content.map((part) => part.text).join("\n");
  }

  async search(query: string): Promise<SearchGroup[]> {
    if (query.length > MAX_QUERY_LENGTH) throw new HubError(`Keep search terms under ${MAX_QUERY_LENGTH + 1} characters.`);
    if (this.demo) return demoSearch(query, [...this.demoSampleNotes, ...this.demoNotes]);
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
    if (clean.length > MAX_NOTE_LENGTH) throw new HubError(`Keep notes under ${MAX_NOTE_LENGTH + 1} characters.`);
    if (!KINDS.includes(kind)) throw new HubError("Choose a valid memory kind.");
    if (this.demo) {
      const normalized = clean.toLowerCase().replace(/\s+/g, " ");
      if ([...this.demoSampleNotes, ...this.demoNotes].some((note) => note.text.toLowerCase().replace(/\s+/g, " ") === normalized)) return { result: "Already known." };
      this.demoNotes.push({ text: clean, source: "app", timestamp: new Date().toISOString() });
      return { result: "Demo capture saved for this session. No note was sent to a hub." };
    }
    const body = await this.request("/remember", true, { text: clean, kind, source: "app" });
    if (!isRecord(body) || typeof body.result !== "string" || !body.result.trim()) throw wrongResponse();
    return { result: body.result };
  }
}
