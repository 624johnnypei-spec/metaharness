import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { fonts, useTheme } from "../theme";
import { Label, Txt } from "./ui";

export function useResource<T>(load: () => Promise<T>, refreshKey = 0) {
  const [value, setValue] = useState<T | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const next = await load();
      if (generation.current === current) setValue(next);
    } catch (reason) {
      if (generation.current === current) setError(reason instanceof Error ? reason.message : "Could not load this page. Try again.");
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }, [load]);
  useEffect(() => {
    setValue(null);
    void refresh();
    return () => { generation.current += 1; };
  }, [refresh, refreshKey]);
  return { value, busy, error, refresh };
}

export function ErrorNotice({ message }: { message: string }) {
  const t = useTheme();
  if (!message) return null;
  return <View accessibilityRole="alert" style={{ borderLeftWidth: 2, borderLeftColor: t.accent, paddingLeft: 14, paddingVertical: 5, marginBottom: 22 }}>
    <Txt style={{ fontSize: 14 }}>{message}</Txt>
  </View>;
}

export function Empty({ title, children }: { title: string; children: ReactNode }) {
  const t = useTheme();
  return <View style={{ paddingVertical: 28, gap: 8, borderBottomWidth: 1, borderBottomColor: t.rule }}>
    <Txt style={{ fontFamily: fonts.display, fontSize: 29, lineHeight: 35 }}>{title}</Txt>
    <Txt muted style={{ fontSize: 14, maxWidth: 520 }}>{children}</Txt>
  </View>;
}

export function Collapsible({ title, index, children, initiallyOpen = true }: { title: string; index?: number; children: ReactNode; initiallyOpen?: boolean }) {
  const t = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  return <View style={{ borderBottomWidth: 1, borderBottomColor: t.rule, marginBottom: 12 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }} aria-expanded={open} onPress={() => setOpen(!open)} style={({ pressed }) => ({ flexDirection: "row", gap: 14, alignItems: "center", paddingVertical: 18, opacity: pressed ? 0.6 : 1 })}>
      {index !== undefined ? <Label style={{ width: 24 }}>{String(index + 1).padStart(2, "0")}</Label> : null}
      <Txt style={{ flex: 1, fontFamily: fonts.display, fontSize: 29, lineHeight: 35 }}>{title}</Txt>
      <Txt muted mono style={{ fontSize: 22, width: 20, textAlign: "center" }}>{open ? "−" : "+"}</Txt>
    </Pressable>
    {open ? <View style={{ paddingBottom: 22 }}>{children}</View> : null}
  </View>;
}

export function dateLabel(value: string | null) {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function briefSections(text: string) {
  const sections: { title: string; text: string }[] = [];
  let preamble = "";
  let current: { title: string; text: string } | null = null;
  let fence = "";
  for (const line of text.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (marker) fence = fence ? (marker.startsWith(fence) ? "" : fence) : marker;
    const heading = !fence && line.match(/^##\s+(.+)$/);
    if (heading) {
      current = { title: heading[1], text: "" };
      sections.push(current);
    } else if (current) current.text += line + "\n";
    else preamble += line + "\n";
  }
  return { preamble: preamble.trim(), sections };
}
