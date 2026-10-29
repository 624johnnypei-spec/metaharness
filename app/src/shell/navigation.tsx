import type { ReactNode } from "react";
import { router, usePathname } from "expo-router";
import { Pressable, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "../state";
import { fonts, useTheme } from "../theme";
import { Action, Label, Txt } from "../components/ui";
import { Mark } from "../components/icons";

const items = [
  { href: "/", label: "Brief" }, { href: "/memory", label: "Memory" },
  { href: "/search", label: "Search" }, { href: "/status", label: "Status" },
  { href: "/settings", label: "Settings" },
] as const;
export function Navigation({ children }: { children: ReactNode }) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= 900;
  const path = usePathname();
  const { openCapture, credentials } = useApp();
  const demo = credentials.token === "demo";
  const nav = <View accessibilityRole="tablist" style={{ flexDirection: wide ? "column" : "row" }}>
    {items.map((item, index) => {
      const selected = path === item.href || (item.href === "/settings" && path === "/connect");
      return <Pressable key={item.href} accessibilityRole="tab" accessibilityLabel={item.label}
        accessibilityState={{ selected }} aria-selected={selected} onPress={() => router.replace(item.href)}
        style={({ pressed }) => ({ flex: wide ? undefined : 1, minHeight: wide ? 58 : 62,
          alignItems: "center", flexDirection: wide ? "row" : "column", justifyContent: wide ? "flex-start" : "center", gap: wide ? 16 : 1,
          borderBottomWidth: wide ? 1 : 0, borderTopWidth: wide ? 0 : 2,
          borderBottomColor: t.rule, borderTopColor: selected ? t.ink : "transparent", opacity: pressed ? 0.65 : 1 })}>
        <Label style={{ color: selected ? t.ink : t.muted, fontSize: 11 }}>0{index + 1}</Label>
        <Txt style={{ fontFamily: selected ? fonts.medium : fonts.body, fontSize: wide ? 16 : 12, color: selected ? t.ink : t.muted }}>{item.label}</Txt>
        {wide && selected ? <Txt style={{ marginLeft: "auto" }}>↗</Txt> : null}
      </Pressable>;
    })}
  </View>;
  return <View style={{ flex: 1, flexDirection: wide ? "row" : "column", backgroundColor: t.paper }}>
    {wide ? <View style={{ width: 226, paddingHorizontal: 28, paddingTop: Math.max(insets.top, 44), paddingBottom: 30, borderRightWidth: 1, borderColor: t.rule }}>
      <View style={{ marginBottom: 52 }}><Mark /><Txt style={{ fontFamily: fonts.display, fontSize: 27, lineHeight: 34, marginTop: 17 }}>Metaharness</Txt></View>
      {nav}
      <View style={{ marginTop: "auto", paddingTop: 40, gap: 20 }}><Action label="＋ Remember" primary onPress={openCapture} /><Label>One shared memory</Label></View>
    </View> : null}
    <View style={{ flex: 1, minWidth: 0, paddingTop: demo ? 0 : insets.top }}>
      {demo ? <View style={{ paddingHorizontal: 24, paddingVertical: 8, paddingTop: wide ? 8 : Math.max(insets.top, 8), backgroundColor: t.ink }}><Txt style={{ color: t.paper, fontSize: 12, lineHeight: 18 }}>Demo · Fictional sample data. Captures stay in this session.</Txt></View> : null}
      {children}
    </View>
    {!wide ? <>
      <Pressable accessibilityRole="button" accessibilityLabel="Remember" onPress={openCapture}
        style={({ pressed }) => ({ position: "absolute", bottom: Math.max(insets.bottom, 8) + 78, right: 24,
          width: 50, height: 50, backgroundColor: t.accent, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}>
        <Txt style={{ fontSize: 29, color: "#F3F0E8", lineHeight: 34 }}>＋</Txt>
      </Pressable>
      <View style={{ borderTopWidth: 1, borderColor: t.rule, paddingHorizontal: 12, paddingBottom: Math.max(insets.bottom, 8), backgroundColor: t.paper }}>{nav}</View>
    </> : null}
  </View>;
}
