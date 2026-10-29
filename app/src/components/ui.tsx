import { ReactNode } from "react";
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleProp,
  Text,
  TextInput,
  TextInputProps,
  TextProps,
  useWindowDimensions,
  View,
  ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, useTheme } from "../theme";

export function Txt({
  muted,
  accent,
  mono,
  style,
  ...props
}: TextProps & { muted?: boolean; accent?: boolean; mono?: boolean }) {
  const t = useTheme();
  return (
    <Text
      {...props}
      style={[
        {
          fontFamily: mono ? fonts.mono : fonts.body,
          fontSize: mono ? 11 : 16,
          lineHeight: mono ? 18 : 24,
          color: accent ? t.accent : muted ? t.muted : t.ink,
        },
        style,
      ]}
    />
  );
}
export function Label({ children, style, ...props }: TextProps) {
  return (
    <Txt
      {...props}
      mono
      muted
      style={[
        {
          fontSize: 11,
          lineHeight: 17,
          letterSpacing: 1.15,
          textTransform: "uppercase",
        },
        style,
      ]}
    >
      {children}
    </Txt>
  );
}
export function Quiet({ children }: { children: ReactNode }) {
  return (
    <Txt muted style={{ fontSize: 14, paddingVertical: 18 }}>
      {children}
    </Txt>
  );
}
export function Page({
  children,
  refresh,
  refreshing = false,
}: {
  children: ReactNode;
  refresh?: () => void;
  refreshing?: boolean;
}) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= 900;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.paper }}
      contentContainerStyle={{
        paddingHorizontal: wide ? 48 : 24,
        paddingTop: wide ? 42 : 28,
        paddingBottom: 80 + insets.bottom,
        maxWidth: 1120,
        width: "100%",
        alignSelf: "center",
      }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        refresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={t.ink}
            colors={[t.ink]}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        paddingBottom: 30,
        marginBottom: 28,
        borderBottomWidth: 1,
        borderBottomColor: t.ink,
      }}
    >
      {eyebrow || action ? (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            minHeight: 32,
            gap: 8,
          }}
        >
          {eyebrow ? <Label>{eyebrow}</Label> : <View />}
          {action}
        </View>
      ) : null}
      <Txt
        accessibilityRole="header"
        style={{
          fontFamily: fonts.display,
          fontSize: 48,
          lineHeight: 55,
          marginTop: eyebrow || action ? 18 : 0,
        }}
      >
        {title}
      </Txt>
      {subtitle ? (
        <Txt muted style={{ marginTop: 8 }}>
          {subtitle}
        </Txt>
      ) : null}
    </View>
  );
}
export function SectionTitle({
  title,
  count,
  action,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: t.ink,
        gap: 8,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "baseline",
          gap: 12,
          flexShrink: 1,
        }}
      >
        <Txt
          accessibilityRole="header"
          style={{ fontFamily: fonts.display, fontSize: 32, lineHeight: 38 }}
        >
          {title}
        </Txt>
        {count !== undefined ? (
          <Label>{String(count).padStart(2, "0")}</Label>
        ) : null}
      </View>
      {action}
    </View>
  );
}
export function Action({
  label,
  onPress,
  primary,
  disabled,
  small,
  style,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 44,
          paddingHorizontal: primary ? 18 : 8,
          paddingVertical: 10,
          backgroundColor: primary ? t.accent : "transparent",
          justifyContent: "center",
          alignItems: "center",
          opacity: disabled ? 0.45 : pressed ? 0.65 : 1,
        },
        style,
      ]}
    >
      <Txt
        style={{
          color: primary ? "#FFFFFF" : t.ink,
          fontFamily: fonts.medium,
          fontSize: small ? 13 : 15,
          lineHeight: 22,
        }}
      >
        {label}
      </Txt>
    </Pressable>
  );
}
export function Field({
  label,
  style,
  ...props
}: TextInputProps & { label: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 8, marginBottom: 22 }}>
      <Label>{label}</Label>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={t.muted}
        selectionColor={t.rule}
        style={[
          {
            fontFamily: fonts.body,
            fontSize: 16,
            lineHeight: 24,
            color: t.ink,
            paddingHorizontal: 0,
            paddingVertical: 10,
            borderBottomColor: t.rule,
            borderBottomWidth: 1,
            minHeight: 46,
            borderRadius: 0,
          },
          style,
        ]}
      />
    </View>
  );
}
export function Rule({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View
      style={[{ borderBottomWidth: 1, borderBottomColor: t.rule }, style]}
    />
  );
}
export function MetaTag({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <Txt
      mono
      style={{
        fontSize: 11,
        letterSpacing: 0.9,
        borderWidth: 1,
        borderColor: t.rule,
        paddingHorizontal: 5,
        lineHeight: 18,
        alignSelf: "flex-start",
      }}
    >
      {children}
    </Txt>
  );
}
