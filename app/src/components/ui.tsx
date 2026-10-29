import type { ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, type StyleProp, Text, TextInput, type TextInputProps, type TextProps, useWindowDimensions, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, useTheme } from "../theme";

export function Txt({ muted, accent, mono, style, ...props }: TextProps & { muted?: boolean; accent?: boolean; mono?: boolean }) {
  const t = useTheme();
  return <Text {...props} allowFontScaling style={[{ fontFamily: mono ? fonts.mono : fonts.body, fontSize: mono ? 12 : 16, lineHeight: mono ? 18 : 24, color: accent ? t.accent : muted ? t.muted : t.ink }, style]} />;
}
export function Label({ style, ...props }: TextProps) {
  return <Txt {...props} muted style={[{ fontSize: 13, lineHeight: 19 }, style]} />;
}
export function Quiet({ children }: { children: ReactNode }) {
  return <Txt muted style={{ fontSize: 15, paddingVertical: 16 }}>{children}</Txt>;
}
export function Page({ children, refresh, refreshing = false, grouped = false }: { children: ReactNode; refresh?: () => void; refreshing?: boolean; grouped?: boolean }) {
  const t = useTheme();
  const wide = useWindowDimensions().width >= 900;
  const insets = useSafeAreaInsets();
  return <ScrollView style={{ flex: 1, backgroundColor: grouped ? t.grouped : t.paper }}
    contentContainerStyle={{ paddingHorizontal: wide ? 32 : 20, paddingTop: wide ? 28 : 8, paddingBottom: 32 + insets.bottom, maxWidth: 820, width: "100%", alignSelf: "center" }} keyboardShouldPersistTaps="handled"
    refreshControl={refresh ? <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.muted} colors={[t.accent]} /> : undefined}>
    {children}
  </ScrollView>;
}
export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  const wide = useWindowDimensions().width >= 900;
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: wide ? 24 : 20, minHeight: 48 }}>
    <Txt accessibilityRole="header" style={{ flex: 1, fontWeight: "700", fontSize: wide ? 26 : 34, lineHeight: wide ? 34 : 42 }}>{title}</Txt>
    {action}
  </View>;
}
export function Action({ label, onPress, primary, disabled, small, style }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean; small?: boolean; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [{ minHeight: 44, paddingHorizontal: primary ? 18 : 8, paddingVertical: 10, borderRadius: 10, backgroundColor: primary ? t.accent : "transparent", justifyContent: "center", alignItems: "center", opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }, style]}>
    <Txt style={{ color: primary ? (t.dark ? "#000000" : "#FFFFFF") : t.accent, fontWeight: "600", fontSize: small ? 14 : 16, lineHeight: 24 }}>{label}</Txt>
  </Pressable>;
}
export function Field({ label, style, ...props }: TextInputProps & { label: string }) {
  const t = useTheme();
  return <View style={{ gap: 7, marginBottom: 16 }}>
    <Txt style={{ fontSize: 14, lineHeight: 20, fontWeight: "500" }}>{label}</Txt>
    <TextInput {...props} allowFontScaling accessibilityLabel={label} placeholderTextColor={t.muted} selectionColor={t.accent}
      style={[{ fontFamily: fonts.body, fontSize: 17, lineHeight: 24, color: t.ink, paddingHorizontal: 13, paddingVertical: 12, backgroundColor: t.surface, borderWidth: 1, borderColor: t.rule, minHeight: 48, borderRadius: 10 }, style]} />
  </View>;
}
export function Group({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <View style={{ backgroundColor: t.surface, borderRadius: 12, overflow: "hidden", marginBottom: 24 }}>{children}</View>;
}
export function Row({ label, value, last = false }: { label: string; value?: ReactNode; last?: boolean }) {
  const t = useTheme();
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center", minHeight: 54, paddingVertical: 14, paddingHorizontal: 16, borderBottomColor: t.rule, borderBottomWidth: last ? 0 : 0.5 }}>
    <Txt style={{ flexGrow: 1 }}>{label}</Txt>
    {typeof value === "string" || typeof value === "number" ? <Txt muted style={{ flexShrink: 1 }}>{value}</Txt> : value}
  </View>;
}
export function Rule({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[{ borderBottomWidth: 0.5, borderBottomColor: t.rule }, style]} />;
}
