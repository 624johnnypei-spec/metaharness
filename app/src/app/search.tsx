import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useApp } from "../state";
import { Action, Field, Label, Page, PageHeader, Txt } from "../components/ui";
import { Markdown } from "../components/markdown";
import { Empty, ErrorNotice } from "../components/content";
import { useTheme } from "../theme";

type Group = { source: string; items: string[] };
export default function Search() {
  const { client, refreshKey } = useApp();
  const t = useTheme();
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  useEffect(() => {
    sequence.current += 1;
    setGroups([]); setSearched(""); setError(""); setBusy(false);
    return () => { sequence.current += 1; };
  }, [client, refreshKey]);
  async function search() {
    const text = query.trim();
    if (!text) return;
    const current = ++sequence.current;
    setBusy(true); setError("");
    try {
      const next = await client.search(text);
      if (current === sequence.current) { setGroups(next); setSearched(text); }
    } catch (reason) {
      if (current === sequence.current) { setGroups([]); setSearched(""); setError(reason instanceof Error ? reason.message : "Search failed. Try again."); }
    } finally {
      if (current === sequence.current) setBusy(false);
    }
  }
  return <Page>
    <PageHeader eyebrow="Search memory" title="Find the thread." subtitle="Look across your sections and shared notes." />
    <View style={{ maxWidth: 800 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
        <View style={{ flex: 1 }}><Field label="Search terms" value={query} onChangeText={setQuery} placeholder="A topic, preference, or idea" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => void search()} /></View>
        <Action label={busy ? "Searching…" : "Search"} primary disabled={busy || !query.trim()} onPress={() => void search()} />
      </View>
      <ErrorNotice message={error} />
      {!searched && !busy && !error ? <Empty title="A little context goes a long way.">Search with a few words you remember. Results are grouped by the file or note they came from.</Empty> : null}
      {searched && !busy ? <Label style={{ marginVertical: 20 }}>{groups.reduce((n, group) => n + group.items.length, 0)} results for “{searched}”</Label> : null}
      {searched && !groups.length && !busy ? <Empty title="No matching memories.">Try a different word or a broader phrase.</Empty> : null}
      {groups.map(group => <View key={group.source} style={{ marginBottom: 30 }}>
        <View style={{ borderBottomWidth: 1, borderBottomColor: t.ink, paddingBottom: 12, marginBottom: 16 }}><Label style={{ color: t.ink }}>{group.source}</Label></View>
        {group.items.map((item, index) => <View key={index} style={{ borderBottomWidth: 1, borderBottomColor: t.rule, paddingBottom: 14, marginBottom: 14 }}><Markdown text={item} compact /></View>)}
      </View>)}
      {busy ? <Txt muted style={{ fontSize: 14 }}>Looking through your shared memory…</Txt> : null}
    </View>
  </Page>;
}
