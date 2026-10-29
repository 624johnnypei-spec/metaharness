import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "../theme";
import { Action, Txt } from "./ui";
import { Icon } from "./icons";

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

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTheme();
  if (!message) return null;
  return <View accessibilityRole="alert" style={{ backgroundColor: t.surface, borderWidth: 1, borderColor: t.rule, borderRadius: 10, padding: 14, marginBottom: 16 }}>
    <Txt style={{ color: t.danger, fontSize: 15 }}>{message}</Txt>
    {onRetry ? <Action label="Retry" onPress={onRetry} style={{ alignSelf: "flex-start", marginTop: 4 }} /> : null}
  </View>;
}

export function Empty({ title, action }: { title: string; action?: ReactNode }) {
  return <View style={{ paddingVertical: 24, alignItems: "flex-start", gap: 8 }}>
    <Txt muted style={{ fontSize: 16 }}>{title}</Txt>{action}
  </View>;
}

export function Collapsible({ title, meta, children, initiallyOpen = true }: { title: string; meta?: ReactNode; children: ReactNode; initiallyOpen?: boolean }) {
  const t = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  return <View style={{ borderBottomWidth: 0.5, borderBottomColor: t.rule, marginBottom: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }} aria-expanded={open} onPress={() => setOpen(!open)}
      style={({ pressed }) => ({ flexDirection: "row", gap: 12, alignItems: "center", paddingVertical: 16, opacity: pressed ? 0.6 : 1 })}>
      <View style={{ flex: 1, gap: 3 }}>
        <Txt style={{ fontSize: 19, lineHeight: 25, fontWeight: "600" }}>{title}</Txt>
        {meta}
      </View>
      <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}><Icon name="chevron" size={14} color={t.muted} /></View>
    </Pressable>
    {open ? <View style={{ paddingBottom: 18 }}>{children}</View> : null}
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
