import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";
import { requireNativeView, requireOptionalNativeModule } from "expo";

type ShortcutHostProps = { children: ReactNode; onRemember: () => void };
type NativeHostProps = ViewProps & { onRemember: () => void };

// Local modules are absent in Expo Go. Keep normal touch controls available
// there without attempting to load a missing native view manager.
const NativeHost = requireOptionalNativeModule("MetaharnessShortcuts")
  ? requireNativeView<NativeHostProps>("MetaharnessShortcuts")
  : null;

export function ShortcutHost({ children, onRemember }: ShortcutHostProps) {
  if (!NativeHost) return <View style={{ flex: 1 }}>{children}</View>;
  return <NativeHost style={{ flex: 1 }} onRemember={onRemember}>{children}</NativeHost>;
}
