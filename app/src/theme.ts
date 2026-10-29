import { Platform, useColorScheme } from "react-native";

export const palette = {
  light: { paper: "#FFFFFF", grouped: "#F2F2F7", surface: "#FFFFFF", sidebar: "#F5F5F7", ink: "#000000", muted: "#66666B", rule: "#E4E4E8", accent: "#0066CC", selection: "#E7F1FF", danger: "#B3261E" },
  dark: { paper: "#000000", grouped: "#000000", surface: "#1C1C1E", sidebar: "#171719", ink: "#FFFFFF", muted: "#A1A1A8", rule: "#303034", accent: "#64ABFF", selection: "#192D46", danger: "#FF8A80" },
};
const system = Platform.OS === "web" ? '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' : "System";
export const fonts = {
  body: system,
  medium: system,
  bold: system,
  mono: Platform.OS === "web" ? 'ui-monospace, "SFMono-Regular", monospace' : "ui-monospace",
};
export function useTheme() {
  const dark = useColorScheme() === "dark";
  return { ...palette[dark ? "dark" : "light"], dark };
}
