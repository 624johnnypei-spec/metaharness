import { View } from "react-native";
import { Txt } from "./ui";
import { useTheme } from "../theme";

export function Mark({ small = false }: { small?: boolean }) {
  const t = useTheme();
  const size = small ? 26 : 34;
  return (
    <View
      accessibilityLabel="Metaharness"
      style={{
        width: size,
        height: size,
        borderWidth: 1.5,
        borderColor: t.ink,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
      }}
    >
      <View
        style={{ width: 1.5, height: size * 0.5, backgroundColor: t.ink }}
      />
      <View
        style={{ width: 1.5, height: size * 0.3, backgroundColor: t.ink }}
      />
      <View
        style={{ width: 1.5, height: size * 0.5, backgroundColor: t.ink }}
      />
    </View>
  );
}
export function Gear() {
  return <Txt style={{ fontSize: 24, lineHeight: 30 }}>⚙︎</Txt>;
}
