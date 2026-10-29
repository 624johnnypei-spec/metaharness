import { useEffect, useState } from "react";
import { Slot, router, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Platform, View } from "react-native";
import { AppProvider, useApp } from "../state";
import { useTheme } from "../theme";
import { Quiet } from "../components/ui";
import { Navigation } from "../shell/navigation";
import { CaptureSheet } from "../shell/capture";
import { ShortcutHost } from "../shell/shortcut-host";
import { subscribeConnection, takeConnection } from "../pending-connection";
import "../global.css";

function App() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { ready, credentials, setIncoming, openCapture } = useApp();
  const path = usePathname();
  useEffect(() => {
    function receive() {
      const value = takeConnection();
      if (value !== undefined) setIncoming(value);
    }
    receive();
    return subscribeConnection(receive);
  }, [setIncoming]);
  useEffect(() => {
    if (ready && !credentials.token && path !== "/settings" && path !== "/connect") router.replace("/settings");
  }, [ready, credentials.token, path]);
  return <View style={{ flex: 1, backgroundColor: t.paper }}>
    <StatusBar style={t.dark ? "light" : "dark"} />
    {ready && credentials.token
      ? <ShortcutHost onRemember={openCapture}><Navigation><Slot /></Navigation></ShortcutHost>
      : <View style={{ flex: 1, paddingTop: insets.top }}><Slot /></View>}
    {!ready ? <View style={{ position: "absolute", inset: 0, backgroundColor: t.paper, padding: 28 }}><Quiet>Loading your connection…</Quiet></View> : null}
    <CaptureSheet />
  </View>;
}
export default function RootLayout() {
  const [hydrated, setHydrated] = useState(Platform.OS !== "web");
  const t = useTheme();
  useEffect(() => setHydrated(true), []);
  if (!hydrated) return <View style={{ flex: 1, justifyContent: "center", backgroundColor: t.paper, padding: 28 }}><Quiet>Loading…</Quiet></View>;
  return <SafeAreaProvider><AppProvider><App /></AppProvider></SafeAreaProvider>;
}
