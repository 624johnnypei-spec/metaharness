import { useColorScheme } from "react-native";

export const palette = {
  light: {
    paper: "#F3F0E8",
    ink: "#151513",
    muted: "#7A786F",
    rule: "#D9D4C7",
    accent: "#E2462C",
  },
  dark: {
    paper: "#0F0F0D",
    ink: "#EDEAE2",
    muted: "#89877F",
    rule: "#2A2925",
    accent: "#E2462C",
  },
};
export const fonts = {
  display: "InstrumentSerif_400Regular",
  body: "IBMPlexSans_400Regular",
  medium: "IBMPlexSans_500Medium",
  bold: "IBMPlexSans_600SemiBold",
  mono: "IBMPlexMono_400Regular",
};
export function useTheme() {
  const dark = useColorScheme() === "dark";
  return { ...palette[dark ? "dark" : "light"], dark };
}
