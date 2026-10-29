export type ProvenanceNote = {
  text: string;
  source: string | null;
  timestamp: string | null;
  dateOnly: boolean;
  file?: string;
};

const datePattern = "\\d{4}-\\d{2}-\\d{2}(?:T[^\\s\\]]+)?";
const noteLine = new RegExp(`^(?:[-*+]\\s+)?\\[(${datePattern})\\s+(?:·\\s*)?([^\\]]+)\\]\\s*(.*)$`);

function validTimestamp(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const calendar = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (calendar.getUTCFullYear() !== Number(match[1]) || calendar.getUTCMonth() !== Number(match[2]) - 1 || calendar.getUTCDate() !== Number(match[3])) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function metadata(text: string, timestamp: string, source: string, hasKind = false): ProvenanceNote {
  const valid = validTimestamp(timestamp);
  return {
    text: text.trim(),
    source: (hasKind ? source.split("/")[0] : source).trim() || null,
    timestamp: valid,
    dateOnly: valid !== null && /^\d{4}-\d{2}-\d{2}$/.test(valid),
  };
}

function unrecorded(text: string): ProvenanceNote {
  return { text, source: null, timestamp: null, dateOnly: false };
}

/** Read emitted metadata, retaining every unlabelled chunk with unknown provenance. */
export function parseJournalNotes(text: string): ProvenanceNote[] {
  const notes: ProvenanceNote[] = [];
  let current: ProvenanceNote | null = null;
  let fence = "";
  function append(line: string) {
    if (current) current.text += "\n" + line;
    else {
      current = unrecorded(line);
      notes.push(current);
    }
  }
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const fenceLine = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    const marker = fenceLine?.[1];
    if (fence) {
      append(line);
      if (marker?.startsWith(fence) && !fenceLine?.[2].trim()) fence = "";
      continue;
    }
    if (marker) { append(line); fence = marker; continue; }
    const match = noteLine.exec(line);
    if (match) {
      current = metadata(match[3], match[1], match[2], !line.slice(0, line.indexOf("]")).includes("·"));
      notes.push(current);
    } else if (/^#{1,6}\s/.test(line) || /^(?:[-*+]|\d+[.)])\s/.test(line)) {
      // A top-level unlabelled item may be another note. Preserve it without
      // assigning the preceding note's author; indented children stay attached.
      current = unrecorded(line);
      notes.push(current);
    } else if (line.trim() || current) {
      append(line);
    }
  }
  return notes.map(note => ({ ...note, text: note.text.trimEnd() })).filter(note => note.text.trim().length > 0);
}

/** Curated files do not record authors; never infer an agent from their text. */
export function parseSearchHit(marker: string, text: string): ProvenanceNote {
  const source = marker.replace(/^\[|\]$/g, "");
  const note = new RegExp(`^(note|journal) (${datePattern}) (.+)$`).exec(source);
  if (note) return metadata(text, note[2], note[3], note[1] === "journal");
  const file = /^(?:self\/)?(?:profile|now|preferences|projects|journal-digest)\.md$/.test(source) ? source.replace(/^self\//, "") : undefined;
  if (file === "journal-digest.md") {
    const parsed = parseJournalNotes(text);
    if (parsed.length === 1) return { ...parsed[0], file };
  }
  return { text: text.trim(), source: null, timestamp: null, dateOnly: false, ...(file ? { file } : {}) };
}

/** A journal search chunk can contain multiple notes; keep each one's metadata. */
export function parseSearchHits(marker: string, text: string): ProvenanceNote[] {
  const source = marker.replace(/^\[|\]$/g, "").replace(/^self\//, "");
  if (source !== "journal-digest.md") return [parseSearchHit(marker, text)];
  const notes = parseJournalNotes(text);
  return notes.length ? notes.map(note => ({ ...note, file: "journal-digest.md" })) : [parseSearchHit(marker, text)];
}

const sourcePalette = [
  { light: ["#165AB4", "#E8F1FF"], dark: ["#9CC2FF", "#18314F"] },
  { light: ["#086C63", "#E3F3EF"], dark: ["#8CDACB", "#163A35"] },
  { light: ["#426D25", "#EDF4E6"], dark: ["#B1D68F", "#293B20"] },
  { light: ["#9D3659", "#F8EAF0"], dark: ["#F0A7C0", "#452536"] },
  { light: ["#3C606C", "#EAF0F3"], dark: ["#AECAD5", "#283A42"] },
  { light: ["#0B6984", "#E4F2F7"], dark: ["#92D3E5", "#193A47"] },
] as const;

/** A source keeps the same label color across views, refreshes, and devices. */
export function sourceColors(source: string, dark: boolean): { foreground: string; background: string } {
  let hash = 2166136261;
  for (const char of source.trim().toLowerCase()) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const colors = sourcePalette[hash % sourcePalette.length][dark ? "dark" : "light"];
  return { foreground: colors[0], background: colors[1] };
}

export function relativeTime(timestamp: string | null, dateOnly = false, now: number | Date = Date.now()): string {
  if (!timestamp || !validTimestamp(timestamp)) return "Time not recorded";
  const current = new Date(now);
  if (dateOnly || /^\d{4}-\d{2}-\d{2}$/.test(timestamp)) {
    const [year, month, day] = timestamp.slice(0, 10).split("-").map(Number);
    // Compare calendar days, without inventing a time or shifting a date-only
    // record across time zones. UTC is used only for arithmetic across DST.
    const days = Math.round((Date.UTC(current.getFullYear(), current.getMonth(), current.getDate()) - Date.UTC(year, month - 1, day)) / 86_400_000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days === -1) return "Tomorrow";
    if (Math.abs(days) < 30) return days > 0 ? `${days}d ago` : `In ${-days}d`;
    return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  const seconds = Math.floor((current.getTime() - Date.parse(timestamp)) / 1000);
  if (Math.abs(seconds) < 60) return "Just now";
  const quantity = Math.abs(seconds) < 3600 ? Math.floor(Math.abs(seconds) / 60) : Math.abs(seconds) < 86_400 ? Math.floor(Math.abs(seconds) / 3600) : Math.floor(Math.abs(seconds) / 86_400);
  const unit = Math.abs(seconds) < 3600 ? "m" : Math.abs(seconds) < 86_400 ? "h" : "d";
  if (Math.abs(seconds) < 30 * 86_400) return seconds >= 0 ? `${quantity}${unit} ago` : `In ${quantity}${unit}`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
