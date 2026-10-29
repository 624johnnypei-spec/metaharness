import { useEffect, useState } from "react";
import { View } from "react-native";
import { parseJournalNotes, relativeTime, sourceColors } from "../../lib/provenance";
import { useTheme } from "../theme";
import { Txt } from "./ui";
import { Markdown } from "./markdown";

export function Provenance({ source, timestamp, dateOnly = false, file }: { source: string | null; timestamp: string | null; dateOnly?: boolean; file?: string }) {
  const t = useTheme();
  const colors = source ? sourceColors(source, t.dark) : null;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  return <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 8 }}>
    {source && colors ? <View testID={`source-${source}`} style={{ backgroundColor: colors.background, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 }}>
      <Txt style={{ color: colors.foreground, fontSize: 12, lineHeight: 18, fontWeight: "600" }}>{source}</Txt>
    </View> : <Txt muted style={{ fontSize: 12, lineHeight: 18 }}>Author not recorded</Txt>}
    {file ? <Txt mono muted>{file}</Txt> : null}
    {timestamp && Number.isFinite(Date.parse(timestamp)) ? <Txt testID="provenance-time" muted style={{ fontSize: 12, lineHeight: 18 }} accessibilityLabel={`Recorded ${timestamp}`}>{relativeTime(timestamp, dateOnly, now)}</Txt> : null}
  </View>;
}
export function JournalContent({ text }: { text: string }) {
  const t = useTheme();
  const notes = parseJournalNotes(text);
  if (notes.every(note => note.timestamp)) notes.sort((a, b) => Date.parse(b.timestamp!) - Date.parse(a.timestamp!));
  if (!notes.length) return <Markdown text={text} />;
  return <View>{notes.map((note, index) => <View key={`${note.source}-${note.timestamp}-${index}`} style={{ paddingVertical: 14, borderBottomColor: t.rule, borderBottomWidth: index === notes.length - 1 ? 0 : 0.5 }}>
    <Provenance {...note} /><Markdown text={note.text} compact />
  </View>)}</View>;
}
