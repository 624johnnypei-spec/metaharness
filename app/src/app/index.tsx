import { useCallback, useMemo } from "react";
import { View, useWindowDimensions } from "react-native";
import { useApp } from "../state";
import { fonts, useTheme } from "../theme";
import { Action, Label, Page, PageHeader, Quiet, Txt } from "../components/ui";
import { Markdown } from "../components/markdown";
import { briefSections, Collapsible, dateLabel, Empty, ErrorNotice, useResource } from "../components/content";

export default function Brief() {
  const { client, refreshKey, credentials } = useApp();
  const t = useTheme();
  const wide = useWindowDimensions().width >= 1100;
  const load = useCallback(async () => {
    const [context, status] = await Promise.all([client.context(), client.status().catch(() => null)]);
    return { context, status };
  }, [client]);
  const { value, busy, error, refresh } = useResource(load, refreshKey);
  const parsed = useMemo(() => briefSections(value?.context ?? ""), [value?.context]);
  return <Page refresh={() => void refresh()} refreshing={busy && !!value}>
    <PageHeader eyebrow="Shared context" title="The brief." subtitle="One context. Every conversation." action={<Action label={busy ? "Refreshing…" : "Refresh"} small disabled={busy} onPress={() => void refresh()} />} />
    <ErrorNotice message={error} />
    {busy && !value ? <Quiet>Reading your shared context…</Quiet> : null}
    {value ? <View style={{ flexDirection: wide ? "row" : "column", gap: wide ? 48 : 26 }}>
      <View style={{ width: wide ? 164 : undefined, gap: 10 }}>
        <Label>{credentials.token === "demo" ? "Sample context" : "Last synced"}</Label>
        <Txt style={{ fontFamily: fonts.medium, fontSize: 14 }}>{value.status ? dateLabel(value.status.last_sync) : "Sync time unavailable"}</Txt>
        {value.status && value.status.pending_notes > 0 ? <Txt muted style={{ fontSize: 13, lineHeight: 20 }}>{value.status.pending_notes} {value.status.pending_notes === 1 ? "note" : "notes"} waiting for the next tick.</Txt> : null}
        <View style={{ height: 2, width: 30, backgroundColor: t.accent, marginVertical: 7 }} />
        <Txt muted style={{ fontSize: 13, lineHeight: 20 }}>The same brief your agents read, directly from your hub.</Txt>
      </View>
      <View style={{ flex: 1, minWidth: 0, maxWidth: 740 }}>
        {parsed.preamble ? <View style={{ marginBottom: parsed.sections.length ? 20 : 0 }}><Markdown text={parsed.preamble} /></View> : null}
        {parsed.sections.map((section, index) => <Collapsible key={`${index}-${section.title}`} title={section.title} index={index}><Markdown text={section.text} /></Collapsible>)}
        {!value.context.trim() ? <Empty title="A fresh start.">Your brief will appear after the next mh tick on your curator machine.</Empty> : null}
      </View>
    </View> : null}
  </Page>;
}
