import { useCallback } from "react";
import { View } from "react-native";
import { useApp } from "../state";
import { Action, Label, Page, PageHeader, Quiet, Txt } from "../components/ui";
import { Markdown } from "../components/markdown";
import { briefSections, Collapsible, ErrorNotice, useResource } from "../components/content";

const sections = [
  { file: "profile.md", title: "Profile", description: "Background and the things that make you, you." },
  { file: "now.md", title: "Now", description: "Current focus and what is happening next." },
  { file: "preferences.md", title: "Preferences", description: "How you like to think, work, and collaborate." },
  { file: "projects.md", title: "Projects", description: "The work and ideas you are carrying forward." },
] as const;

export default function Memory() {
  const { client, refreshKey } = useApp();
  const load = useCallback(async () => {
    const [curated, context] = await Promise.all([
      Promise.all(sections.map(async section => ({ ...section, text: (await client.section(section.file)).replace(/<!--[\s\S]*?-->/g, "").replace(/^#\s+[^\n]+\n?/, "").trim() }))),
      client.context(),
    ]);
    const notes = briefSections(context).sections.filter(section => ["Recently learned by other agents", "New remote memories (not yet synced locally)"].includes(section.title));
    return { curated, notes };
  }, [client]);
  const { value, busy, error, refresh } = useResource(load, refreshKey);
  return <Page refresh={() => void refresh()} refreshing={busy && !!value}>
    <PageHeader eyebrow="Curated memory" title="What stays." subtitle="Four living sections, kept in your own words." action={<Action label={busy ? "Refreshing…" : "Refresh"} small disabled={busy} onPress={() => void refresh()} />} />
    <ErrorNotice message={error} />
    {busy && !value ? <Quiet>Reading your curated memory…</Quiet> : null}
    <View style={{ maxWidth: 820 }}>
      {value?.curated.map((section, index) => <Collapsible key={section.file} title={section.title} index={index}>
        <Label style={{ marginBottom: 12 }}>{section.file}</Label>
        {section.text ? <Markdown text={section.text} /> : <Txt muted style={{ fontSize: 14 }}>{section.description} This section is empty for now.</Txt>}
      </Collapsible>)}
      {value?.notes.map((section, index) => <Collapsible key={section.title} title={section.title.startsWith("New remote") ? "Queued notes" : "Recent notes"} index={index + 4}>
        <Markdown text={section.text} />
      </Collapsible>)}
      {value ? <Txt muted style={{ fontSize: 13, lineHeight: 20, marginTop: 16 }}>New notes reach your curator on the next mh tick. These sections update when the curator folds them in.</Txt> : null}
    </View>
  </Page>;
}
