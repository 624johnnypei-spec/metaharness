import { useCallback } from "react";
import { View } from "react-native";
import { useApp } from "../state";
import { Action, Page, PageHeader, Quiet, Txt } from "../components/ui";
import { Markdown } from "../components/markdown";
import { JournalContent } from "../components/provenance";
import { briefSections, Collapsible, Empty, ErrorNotice, useResource } from "../components/content";

const sections = [
  { file: "profile.md", title: "Profile" },
  { file: "now.md", title: "Now" },
  { file: "preferences.md", title: "Preferences" },
  { file: "projects.md", title: "Projects" },
] as const;

export default function Memory() {
  const { client, refreshKey, openCapture } = useApp();
  const load = useCallback(async () => {
    const [curated, context] = await Promise.all([
      Promise.all(sections.map(async section => ({ ...section, text: (await client.section(section.file)).replace(/<!--[\s\S]*?-->/g, "").replace(/^#\s+[^\n]+\n?/, "").trim() }))),
      client.context(),
    ]);
    const notes = briefSections(context).sections.filter(section => ["Recently learned by other agents", "New remote memories (not yet synced locally)", "Demo captures"].includes(section.title));
    return { curated, notes };
  }, [client]);
  const { value, busy, error, refresh } = useResource(load, refreshKey);
  return <Page refresh={() => void refresh()} refreshing={busy && !!value}>
    <PageHeader title="Memory" action={<Action label={busy ? "Refreshing…" : "Refresh"} small disabled={busy} onPress={() => void refresh()} />} />
    <ErrorNotice message={error} onRetry={() => void refresh()} />
    {busy && !value ? <Quiet>Loading…</Quiet> : null}
    {value ? <View>
      {value.notes.map(section => <View key={section.title} style={{ marginBottom: 28 }}>
        <Txt accessibilityRole="header" style={{ fontSize: 18, fontWeight: "600", marginBottom: 14 }}>{section.title.startsWith("New remote") ? "Queued notes" : "Recent notes"}</Txt>
        <JournalContent text={section.text} />
      </View>)}
      <Txt accessibilityRole="header" style={{ fontSize: 18, fontWeight: "600", marginBottom: 6 }}>Curated sections</Txt>
      {value.curated.map(section => <Collapsible key={section.file} title={section.title} initiallyOpen={!value.notes.length && section.file === "profile.md"}
        meta={<Txt mono muted style={{ fontSize: 12 }}>{section.file}</Txt>}>
        {section.text ? <Markdown text={section.text} /> : <Empty title="No content yet" action={<Action label="Remember" onPress={openCapture} />} />}
      </Collapsible>)}
      {!value.notes.length ? <View style={{ marginTop: 24 }}><Empty title="No recent notes" action={<Action label="Remember" onPress={openCapture} />} /></View> : null}
    </View> : null}
  </Page>;
}
