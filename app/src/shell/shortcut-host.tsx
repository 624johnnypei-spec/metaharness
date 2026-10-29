import type { ReactNode } from "react";
import { View } from "react-native";

export type ShortcutHostProps = { children: ReactNode; onRemember: () => void };

export function ShortcutHost({ children }: ShortcutHostProps) {
  return <View style={{ flex: 1 }}>{children}</View>;
}
