import { Pressable, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { useTheme } from "../theme";

export type IconName = "brief" | "memory" | "search" | "status" | "settings" | "plus" | "chevron" | "refresh" | "close" | "link";
const paths: Record<IconName, string> = {
  brief: "M7 3.5h7l4 4V20H6V3.5h1 M14 3.5V8h4 M9 12h6 M9 16h6",
  memory: "M5 5h14v14H5z M8 2.5h8 M8 21.5h8 M8.5 9h7 M8.5 13h7",
  search: "M17 17l4.5 4.5 M19 10.5a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  status: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M7.5 12l3 3 6-6",
  settings: "M9.5 3h5l.6 2.2 2 .9 2.1-.7 2.5 4.3-1.5 1.6v2.4l1.5 1.6-2.5 4.3-2.1-.7-2 .9-.6 2.2h-5l-.6-2.2-2-.9-2.1.7L2.3 15l1.5-1.6V11L2.3 9.4l2.5-4.3 2.1.7 2-.9L9.5 3 M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0",
  plus: "M12 4v16 M4 12h16",
  chevron: "M9 5l7 7-7 7",
  refresh: "M20 9a8 8 0 1 0-1 9 M20 3v6h-6",
  close: "M6 6l12 12 M6 18 18 6",
  link: "M10 8l3-3a4 4 0 0 1 6 6l-3 3 M14 16l-3 3a4 4 0 0 1-6-6l3-3 M8 16l8-8",
};
export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: string }) {
  const t = useTheme();
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden aria-hidden>
    <Path d={paths[name]} stroke={color ?? t.ink} strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}
export function IconButton({ name, label, onPress, disabled }: { name: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ width: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.4 : pressed ? 0.55 : 1 })}>
    <Icon name={name} color={t.accent} />
  </Pressable>;
}
export function Mark({ small = false }: { small?: boolean }) {
  const t = useTheme();
  return <View accessibilityLabel="Metaharness"><Svg width={small ? 24 : 44} height={small ? 24 : 44} viewBox="0 0 64 64" aria-hidden>
    <Path d="M10 37 32 49 54 37v9L32 58 10 46z" fill={t.accent} />
    <Path d="M10 24 32 36 54 24v9L32 45 10 33z" fill={t.accent} />
    <Path d="M10 20 32 8 54 20 32 32z" fill={t.accent} />
  </Svg></View>;
}
