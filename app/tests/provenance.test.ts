/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseJournalNotes, parseSearchHit, parseSearchHits, relativeTime, sourceColors } from "../lib/provenance.ts";
import { createDemoNotes } from "../lib/demo.ts";
import { HubClient } from "../lib/api.ts";

test("brief journal metadata preserves real sources and date precision", () => {
  assert.deepEqual(parseJournalNotes("## Recent notes\n\n- [2026-10-29 · claude-code] Prefer short assembly steps.\n- [2026-10-28T12:35:00Z · app] Measure the hinge.\nSecond line.\n\n## Sharing back\nUnrelated text"), [
    { text: "## Recent notes", source: null, timestamp: null, dateOnly: false },
    { text: "Prefer short assembly steps.", source: "claude-code", timestamp: "2026-10-29", dateOnly: true },
    { text: "Measure the hinge.\nSecond line.", source: "app", timestamp: "2026-10-28T12:35:00Z", dateOnly: false },
    { text: "## Sharing back\nUnrelated text", source: null, timestamp: null, dateOnly: false },
  ]);
});

test("journal digest notation separates source from kind", () => {
  assert.deepEqual(parseJournalNotes("- [2026-10-29 gemini/preference] Use drawings · and short captions."), [
    { text: "Use drawings · and short captions.", source: "gemini", timestamp: "2026-10-29", dateOnly: true },
  ]);
  assert.deepEqual(parseSearchHit("journal-digest.md", "- [2026-10-29 interview/profile] Works at a community workshop."), {
    text: "Works at a community workshop.", source: "interview", timestamp: "2026-10-29", dateOnly: true, file: "journal-digest.md",
  });
});

test("search metadata supports local and remote note markers", () => {
  assert.deepEqual(parseSearchHit("note 2026-10-29 chatgpt", "Test the prototype."), {
    text: "Test the prototype.", source: "chatgpt", timestamp: "2026-10-29", dateOnly: true,
  });
  assert.deepEqual(parseSearchHit("journal 2026-10-29 cli/note/personal", "Keep a sketchbook."), {
    text: "Keep a sketchbook.", source: "cli", timestamp: "2026-10-29", dateOnly: true,
  });
});

test("curated hits never guess an author or timestamp from their contents", () => {
  const text = "- [2026-10-29 · codex] A quotation within a curated file";
  assert.deepEqual(parseSearchHit("self/profile.md", text), {
    text, source: null, timestamp: null, dateOnly: false, file: "profile.md",
  });
  assert.deepEqual(parseSearchHit("unrecognized source", "A hit"), {
    text: "A hit", source: null, timestamp: null, dateOnly: false,
  });
});

test("code examples are not promoted into real journal records", () => {
  assert.deepEqual(parseJournalNotes("```md\n- [2026-10-29 · codex] Example syntax\n```\n- Plain list item"), [
    { text: "```md\n- [2026-10-29 · codex] Example syntax\n```", source: null, timestamp: null, dateOnly: false },
    { text: "- Plain list item", source: null, timestamp: null, dateOnly: false },
  ]);
  const nested = "````md\n```\n- [2026-10-29 · codex] Example syntax\n````";
  assert.deepEqual(parseJournalNotes(nested), [{ text: nested, source: null, timestamp: null, dateOnly: false }]);
  const invalidClose = "```md\n```not-a-closing-fence\n- [2026-10-29 · codex] Still example syntax\n```";
  assert.deepEqual(parseJournalNotes(invalidClose), [{ text: invalidClose, source: null, timestamp: null, dateOnly: false }]);
});

test("multiline notes preserve paragraphs, nested lists and quoted metadata", () => {
  const body = "First paragraph.\n\nSecond paragraph.\n  - An indented detail\n  - [2026-10-28 · gemini] Quoted nested syntax\n\n```md\n- [2026-10-28 · codex] A code example, not another record\n```";
  const notes = parseJournalNotes(`- [2026-10-29T12:00:00Z · app] ${body}\n- [2026-10-29 · cli] Another note`);
  assert.equal(notes.length, 2);
  assert.equal(notes[0].text, body);
  assert.equal(notes[0].source, "app");
  assert.equal(notes[1].source, "cli");
});

test("unmatched notes and headings are retained without inheriting an author", () => {
  const notes = parseJournalNotes("An unlabelled introduction\n- [2026-10-29 · app] Known note\n- Unlabelled bullet\nContinuation\n## Extra details\nSome details\n1. An unlabelled numbered note\n- [2026-10-29 · cli] Final known note");
  assert.deepEqual(notes.map(({ text, source }) => ({ text, source })), [
    { text: "An unlabelled introduction", source: null },
    { text: "Known note", source: "app" },
    { text: "- Unlabelled bullet\nContinuation", source: null },
    { text: "## Extra details\nSome details", source: null },
    { text: "1. An unlabelled numbered note", source: null },
    { text: "Final known note", source: "cli" },
  ]);
  assert.ok(notes.filter(note => note.source === null).every(note => note.timestamp === null));
});

test("combined journal search chunks retain each note and its own provenance", () => {
  const text = "- [2026-10-29 codex/note] First result\n\n- Unknown result\n\n- [2026-10-28 claude-code/preference] Third result";
  const hits = parseSearchHits("journal-digest.md", text);
  assert.deepEqual(hits.map(({ text, source, file }) => ({ text, source, file })), [
    { text: "First result", source: "codex", file: "journal-digest.md" },
    { text: "- Unknown result", source: null, file: "journal-digest.md" },
    { text: "Third result", source: "claude-code", file: "journal-digest.md" },
  ]);
  assert.deepEqual(parseSearchHits("self/profile.md", text), [{ text, source: null, timestamp: null, dateOnly: false, file: "profile.md" }]);
  assert.equal(parseSearchHits("note 2026-10-29 app", text).length, 1, "A direct note hit has one explicit author even when its body quotes metadata");
});

test("invalid calendar dates are kept unknown instead of being normalized", () => {
  const notes = parseJournalNotes("- [2026-02-31 · claude-app] An invalid timestamp");
  assert.equal(notes[0].timestamp, null);
  assert.equal(notes[0].source, "claude-app");
  assert.equal(relativeTime("2026-02-31"), "Time not recorded");
  assert.equal(relativeTime(null), "Time not recorded");
});

test("date-only records use calendar days and never invent minutes", () => {
  const now = new Date(2026, 9, 29, 20, 30);
  assert.equal(relativeTime("2026-10-29", true, now), "Today");
  assert.equal(relativeTime("2026-10-28", true, now), "Yesterday");
  assert.equal(relativeTime("2026-10-27", true, now), "2d ago");
  assert.equal(relativeTime("2026-10-30", true, now), "Tomorrow");
});

test("full timestamps use elapsed time including explicit future dates", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  assert.equal(relativeTime("2026-10-29T11:59:45Z", false, now), "Just now");
  assert.equal(relativeTime("2026-10-29T11:25:00Z", false, now), "35m ago");
  assert.equal(relativeTime("2026-10-29T09:00:00Z", false, now), "3h ago");
  assert.equal(relativeTime("2026-10-29T14:00:00Z", false, now), "In 2h");
});

test("source colors are deterministic and theme-specific", () => {
  for (const source of ["codex", "claude-code", "gemini", "chatgpt", "claude-app", "cli", "app", "interview"]) {
    assert.deepEqual(sourceColors(source, false), sourceColors(` ${source.toUpperCase()} `, false));
    assert.notDeepEqual(sourceColors(source, false), sourceColors(source, true));
    assert.match(sourceColors(source, false).foreground, /^#[\da-f]{6}$/i);
    assert.match(sourceColors(source, true).background, /^#[\da-f]{6}$/i);
  }
});

test("sample provenance is fictional and capture provenance uses the actual session", async () => {
  const samples = createDemoNotes(Date.parse("2026-10-29T12:00:00Z"));
  assert.equal(samples[0].source, "codex");
  assert.equal(samples[0].timestamp, "2026-10-29T11:25:00.000Z");
  const client = new HubClient({ url: "", token: "demo" }, () => { throw new Error("Demo must not send requests"); });
  const before = Date.now();
  await client.remember("Test the session prototype", "project");
  const hits = await client.search("session prototype");
  const hit = hits.flatMap(group => group.items.map(item => parseSearchHit(group.source, item))).find(item => item.text === "Test the session prototype");
  assert.equal(hit?.source, "app");
  assert.equal(hit?.dateOnly, false);
  assert.ok(Date.parse(hit!.timestamp!) >= before);
  assert.ok(Date.parse(hit!.timestamp!) <= Date.now());
});
