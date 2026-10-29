import { useCallback } from "react";
import { relativeTime } from "../../lib/provenance";
import { useApp } from "../state";
import { Action, Group, Page, PageHeader, Quiet, Row, Txt } from "../components/ui";
import { dateLabel, ErrorNotice, useResource } from "../components/content";

export default function Status() {
  const { client, refreshKey, credentials } = useApp();
  const load = useCallback(() => client.status(), [client]);
  const { value, busy, error, refresh } = useResource(load, refreshKey);
  return <Page grouped refresh={() => void refresh()} refreshing={busy && !!value}>
    <PageHeader title="Status" action={<Action label={busy ? "Refreshing…" : "Refresh"} small disabled={busy} onPress={() => void refresh()} />} />
    <ErrorNotice message={error} onRetry={() => void refresh()} />
    {busy && !value ? <Quiet>Loading…</Quiet> : null}
    {value ? <>
      <Group>
        <Row label="Connection" value={credentials.token === "demo" ? "Demo" : "Connected"} />
        <Row label="Last sync" value={value.last_sync ? relativeTime(value.last_sync) : "Not synced"} />
        <Row label="Pending notes" value={String(value.pending_notes)} last />
      </Group>
      {value.last_sync ? <Txt mono muted style={{ fontSize: 12, marginTop: 10, marginHorizontal: 16 }}>{dateLabel(value.last_sync)}</Txt> : null}
      {value.pending_notes > 0 ? <Txt muted style={{ fontSize: 13, marginTop: 16, marginHorizontal: 16 }}>{credentials.token === "demo" ? "Sample captures · this session" : "Queued until the next mh tick"}</Txt> : null}
    </> : null}
  </Page>;
}
