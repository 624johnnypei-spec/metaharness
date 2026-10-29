import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { relativeTime } from "../../lib/provenance";
import { useApp } from "../state";
import { Action, Page, PageHeader, Quiet, Txt } from "../components/ui";
import { Markdown } from "../components/markdown";
import { JournalContent } from "../components/provenance";
import { briefSections, Collapsible, Empty, ErrorNotice, useResource } from "../components/content";

const isJournal = (title: string) => ["Recently learned by other agents", "New remote memories (not yet synced locally)", "Demo captures"].includes(title);
const sectionTitle = (title: string) => title === "Recently learned by other agents" ? "Recent notes" : title === "New remote memories (not yet synced locally)" ? "Queued notes" : title;

export default function Brief() {
  const { client, refreshKey, openCapture } = useApp();
  const load = useCallback(async () => {
    const [context, status] = await Promise.all([client.context(), client.status().catch(() => null)]);
    return { context, status };
  }, [client]);
  const { value, busy, error, refresh } = useResource(load, refreshKey);
  const parsed = useMemo(() => briefSections(value?.context ?? ""), [value?.context]);
  const synced = value?.status?.last_sync;
  return <Page refresh={() => void refresh()} refreshing={busy && !!value}>
    <PageHeader title="Brief" action={<Action label={busy ? "Refreshing…" : "Refresh"} small disabled={busy} onPress={() => void refresh()} />} />
    <ErrorNotice message={error} onRetry={() => void refresh()} />
    {busy && !value ? <Quiet>Loading…</Quiet> : null}
    {value ? <View>
      {parsed.preamble ? <View style={{ marginBottom: 16 }}><Markdown text={parsed.preamble} /></View> : null}
      {value.status && value.status.pending_notes > 0 ? <Txt muted style={{ fontSize: 13, marginBottom: 16 }}>{value.status.pending_notes} {value.status.pending_notes === 1 ? "note" : "notes"} pending sync</Txt> : null}
      {parsed.sections.map((section, index) => <Collapsible key={`${index}-${section.title}`} title={sectionTitle(section.title)}
        meta={!isJournal(section.title) ? <Txt muted style={{ fontSize: 12 }}>{synced ? `Synced ${relativeTime(synced).replace(/^(Just|Today|Yesterday|Tomorrow|In)/, word => word.toLowerCase())}` : "Update time not recorded"}</Txt> : undefined}>
        {isJournal(section.title) ? <JournalContent text={section.text} /> : <Markdown text={section.text} />}
      </Collapsible>)}
      {!value.context.trim() ? <Empty title="No shared context yet" action={<Action label="Remember" onPress={openCapture} />} /> : null}
    </View> : null}
  </Page>;
}
