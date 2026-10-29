import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { parseSearchHits } from "../../lib/provenance";
import { useApp } from "../state";
import { Action, Field, Page, PageHeader, Quiet, Txt } from "../components/ui";
import { Markdown } from "../components/markdown";
import { Provenance } from "../components/provenance";
import { Empty, ErrorNotice } from "../components/content";
import { useTheme } from "../theme";

type SearchGroup = { source: string; items: string[] };
export default function Search() {
  const { client, refreshKey, openCapture } = useApp();
  const t = useTheme();
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
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
    <PageHeader title="Search" />
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ flex: 1 }}><Field label="Search terms" value={query} onChangeText={setQuery} placeholder="Search memories" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => void search()} /></View>
      <Action label={busy ? "Searching…" : "Search"} disabled={busy || !query.trim()} onPress={() => void search()} />
    </View>
    <ErrorNotice message={error} onRetry={() => void search()} />
    {!searched && !busy && !error ? <Quiet>Enter a word or phrase</Quiet> : null}
    {searched && !busy ? <Txt muted style={{ fontSize: 13, marginTop: 8, marginBottom: 18 }}>{groups.reduce((n, group) => n + group.items.flatMap(item => parseSearchHits(group.source, item)).length, 0)} results</Txt> : null}
    {searched && !groups.length && !busy ? <Empty title="No matching memories" action={<Action label="Remember" onPress={openCapture} />} /> : null}
    {groups.map(group => <View key={group.source} style={{ marginBottom: 24 }}>
      <Txt mono muted style={{ fontSize: 12, marginBottom: 12 }}>{group.source}</Txt>
      {group.items.flatMap(item => parseSearchHits(group.source, item)).map((hit, index) => {
        return <View key={index} style={{ borderBottomWidth: 0.5, borderBottomColor: t.rule, paddingBottom: 14, marginBottom: 16, gap: 10 }}>
          <Provenance source={hit.source} timestamp={hit.timestamp} dateOnly={hit.dateOnly} />
          <Markdown text={hit.text} compact />
        </View>;
      })}
    </View>)}
    {busy ? <Quiet>Searching…</Quiet> : null}
  </Page>;
}
