import { useCallback } from "react";
import { View, useWindowDimensions } from "react-native";
import { useApp } from "../state";
import { fonts, useTheme } from "../theme";
import { Action, Label, Page, PageHeader, Quiet, Txt } from "../components/ui";
import { dateLabel, ErrorNotice, useResource } from "../components/content";

export default function Status() {
  const { client, refreshKey, credentials } = useApp();
  const t = useTheme();
  const wide = useWindowDimensions().width >= 900;
  const load = useCallback(() => client.status(), [client]);
  const { value, busy, error, refresh } = useResource(load, refreshKey);
  return <Page refresh={() => void refresh()} refreshing={busy && !!value}>
    <PageHeader eyebrow={credentials.token === "demo" ? "Demo status" : "Hub status"} title="In the loop." subtitle="What your hub knows about the latest sync." action={<Action label={busy ? "Refreshing…" : "Refresh"} small disabled={busy} onPress={() => void refresh()} />} />
    <ErrorNotice message={error} />
    {busy && !value ? <Quiet>Checking the hub…</Quiet> : null}
    {value ? <View style={{ maxWidth: 820 }}>
      <View style={{ flexDirection: wide ? "row" : "column", borderBottomWidth: 1, borderBottomColor: t.rule, paddingBottom: 30, gap: 32 }}>
        <View style={{ flex: 1, gap: 14 }}>
          <Label>Last brief sync</Label>
          <Txt style={{ fontFamily: fonts.display, fontSize: 34, lineHeight: 42 }}>{dateLabel(value.last_sync)}</Txt>
          <Txt muted style={{ fontSize: 13, lineHeight: 20 }}>The last time your curator uploaded the shared brief.</Txt>
        </View>
        <View style={{ flex: 1, gap: 14 }}>
          <Label>Notes awaiting sync</Label>
          <Txt style={{ fontFamily: fonts.display, fontSize: 56, lineHeight: 60 }}>{value.pending_notes}</Txt>
          <Txt muted style={{ fontSize: 13, lineHeight: 20 }}>{value.pending_notes ? "Saved to the hub and waiting for your curator." : "No notes are waiting on the hub."}</Txt>
        </View>
      </View>
      <View style={{ paddingVertical: 30, gap: 14 }}>
        <Label>From capture to context</Label>
        <Txt style={{ fontSize: 15, maxWidth: 620 }}>A captured note is shared immediately. The next mh tick on your curator machine imports it locally and refreshes the brief.</Txt>
        <Txt muted style={{ fontSize: 13, lineHeight: 20, maxWidth: 620 }}>The hub reports sync information only. It does not track whether individual agents are online.</Txt>
      </View>
    </View> : null}
  </Page>;
}
