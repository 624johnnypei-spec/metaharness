import { useEffect, useState } from "react";
import { Slot, router, usePathname } from "expo-router";
import { useFonts } from "expo-font";
import { InstrumentSerif_400Regular } from "@expo-google-fonts/instrument-serif/400Regular";
import { IBMPlexSans_400Regular } from "@expo-google-fonts/ibm-plex-sans/400Regular";
import { IBMPlexSans_500Medium } from "@expo-google-fonts/ibm-plex-sans/500Medium";
import { IBMPlexSans_600SemiBold } from "@expo-google-fonts/ibm-plex-sans/600SemiBold";
import { IBMPlexMono_400Regular } from "@expo-google-fonts/ibm-plex-mono/400Regular";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Platform, View } from "react-native";
import { AppProvider, useApp } from "../state";
import { useTheme } from "../theme";
import { Quiet } from "../components/ui";
import { Navigation } from "../shell/navigation";
import { CaptureSheet } from "../shell/capture";
import { subscribeConnection, takeConnection } from "../pending-connection";
import "../global.css";

function App() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { ready, credentials, setIncoming } = useApp();
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
      ? <Navigation><Slot /></Navigation>
      : <View style={{ flex: 1, paddingTop: insets.top }}><Slot /></View>}
    {!ready ? <View style={{ position: "absolute", inset: 0, backgroundColor: t.paper, padding: 28 }}><Quiet>Loading your connection…</Quiet></View> : null}
    <CaptureSheet />
  </View>;
}
export default function RootLayout() {
  const [loaded, error] = useFonts({ InstrumentSerif_400Regular, IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold, IBMPlexMono_400Regular });
  const [hydrated, setHydrated] = useState(Platform.OS !== "web");
  const t = useTheme();
  useEffect(() => setHydrated(true), []);
  if (!hydrated || (!loaded && !error)) return <View style={{ flex: 1, justifyContent: "center", backgroundColor: t.paper, padding: 28 }}><Quiet>Loading…</Quiet></View>;
  return <SafeAreaProvider><AppProvider><App /></AppProvider></SafeAreaProvider>;
}
