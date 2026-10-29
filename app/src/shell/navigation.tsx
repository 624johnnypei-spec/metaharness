import { useEffect, type ReactNode } from "react";
import { router, usePathname } from "expo-router";
import { Platform, Pressable, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "../state";
import { useTheme } from "../theme";
import { Txt } from "../components/ui";
import { Icon, IconButton, Mark, type IconName } from "../components/icons";

const items = [
  { href: "/", label: "Brief", icon: "brief" }, { href: "/memory", label: "Memory", icon: "memory" },
  { href: "/search", label: "Search", icon: "search" }, { href: "/status", label: "Status", icon: "status" },
  { href: "/settings", label: "Settings", icon: "settings" },
] as const;
export function Navigation({ children }: { children: ReactNode }) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= 900;
  const path = usePathname();
  const { openCapture, credentials } = useApp();
  const demo = credentials.token === "demo";
  useEffect(() => {
    if (Platform.OS !== "web") return;
    function key(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !event.repeat) { event.preventDefault(); openCapture(); }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [openCapture]);
  let hubLabel = "";
  try { hubLabel = new URL(credentials.url).host; } catch {}
  const nav = <View accessibilityRole="tablist" style={{ flexDirection: wide ? "column" : "row", gap: wide ? 3 : 0 }}>
    {items.map(item => {
      const selected = path === item.href || (item.href === "/settings" && path === "/connect");
      const color = selected ? t.accent : t.muted;
      return <Pressable key={item.href} accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected }} aria-selected={selected} onPress={() => router.replace(item.href)}
        style={({ pressed }) => ({ flex: wide ? undefined : 1, minHeight: wide ? 38 : 54, paddingHorizontal: wide ? 12 : 0, borderRadius: wide ? 7 : 0,
          alignItems: "center", flexDirection: wide ? "row" : "column", justifyContent: wide ? "flex-start" : "center", gap: wide ? 10 : 2,
          backgroundColor: wide && selected ? t.selection : "transparent", opacity: pressed ? 0.6 : 1 })}>
        <Icon name={item.icon as IconName} size={wide ? 19 : 23} color={color} />
        <Txt style={{ fontWeight: selected ? "600" : "400", fontSize: wide ? 14 : 10, lineHeight: wide ? 22 : 16, color }}>{item.label}</Txt>
      </Pressable>;
    })}
  </View>;
  return <View style={{ flex: 1, flexDirection: wide ? "row" : "column", backgroundColor: t.paper }}>
    {wide ? <View style={{ width: 220, paddingHorizontal: 12, paddingTop: insets.top, borderRightWidth: 0.5, borderColor: t.rule, backgroundColor: t.sidebar }}>
      <View style={{ height: 64, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12 }}><Mark small /><Txt style={{ fontSize: 15, fontWeight: "600" }}>Metaharness</Txt></View>
      {nav}
    </View> : null}
    <View style={{ flex: 1, minWidth: 0, paddingTop: insets.top }}>
      <View style={{ minHeight: wide ? 52 : 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: wide ? 24 : 12, borderBottomWidth: wide ? 0.5 : 0, borderColor: t.rule }}>
        <Txt muted numberOfLines={1} style={{ fontSize: 12, flex: 1, marginHorizontal: 8 }} accessibilityLabel={demo ? "Demo mode" : "Connected hub"}>{demo ? "Demo" : hubLabel}</Txt>
        {wide ? <Pressable accessibilityRole="button" accessibilityLabel="Remember" onPress={openCapture} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 8, minHeight: 44, opacity: pressed ? 0.6 : 1 })}>
          <Icon name="plus" size={18} color={t.accent} /><Txt accent style={{ fontSize: 14, fontWeight: "500" }}>Remember</Txt><Txt muted style={{ fontSize: 12, marginLeft: 8 }}>{Platform.OS === "ios" ? "⌘K" : "⌘ / Ctrl K"}</Txt>
        </Pressable> : <IconButton name="plus" label="Remember" onPress={openCapture} />}
      </View>
      {children}
    </View>
    {!wide ? <View style={{ borderTopWidth: 0.5, borderColor: t.rule, paddingHorizontal: 8, paddingBottom: Math.max(insets.bottom, 6), backgroundColor: t.surface }}>{nav}</View> : null}
  </View>;
}
