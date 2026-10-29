import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Platform, View } from "react-native";
import { HubClient } from "../../lib/api";
import { validateCredentials } from "../../lib/links";
import type { Credentials } from "../../lib/types";
import { useApp } from "../state";
import { useTheme } from "../theme";
import { Action, Field, Label, Page, PageHeader, Txt } from "../components/ui";
import { Mark } from "../components/icons";

export default function Settings() {
  const { credentials, configure, disconnect, ready, configError, incoming, setIncoming } = useApp();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const t = useTheme();
  const { invalid } = useLocalSearchParams<{ invalid?: string }>();
  useEffect(() => {
    if (ready) {
      setUrl((incoming ?? credentials).url);
      setToken((incoming ?? credentials).token);
      setMessage(incoming ? "Connection link received. Test it, then connect to save it on this device." : "");
      setError(false);
    }
  }, [ready, credentials, incoming]);
  const connected = Boolean(credentials.token);
  function fail(error: unknown) {
    setError(true);
    setMessage(error instanceof Error ? error.message : "Could not save the connection. Please try again.");
  }
  async function connect(save: boolean, demo = false) {
    setBusy(true); setMessage(""); setError(false);
    try {
      const value: Credentials = validateCredentials(demo ? { url: "", token: "demo" } : { url, token });
      await new HubClient(value).context();
      if (save) {
        await configure(value);
        router.replace("/");
      } else {
        setMessage(value.token === "demo" ? "Demo is ready. All sample data is fictional." : "Connected. Your hub returned shared context.");
      }
    } catch (error) { fail(error); }
    finally { setBusy(false); }
  }
  async function leave() {
    setBusy(true);
    try { await disconnect(); setUrl(""); setToken(""); setMessage("Disconnected. Saved credentials were removed from this device."); }
    catch (error) { fail(error); }
    finally { setBusy(false); }
  }
  return <Page><View style={{ width: "100%", maxWidth: 620, alignSelf: "center" }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 36 }}>
      <Mark /><Label>Metaharness / Connection</Label>
    </View>
    <PageHeader title={connected ? "Connection settings" : "A memory in common."}
      subtitle={connected ? "Your hub. Available wherever you are." : "Connect your hub to read the context your agents share, and add what they should remember."} />
    <Field label="Hub URL" value={url} onChangeText={value => { setUrl(value); setMessage(""); }}
      placeholder="https://your-hub.example" autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!busy} />
    <Field label="Token" value={token} onChangeText={value => { setToken(value); setMessage(""); }}
      placeholder="Paste your hub token" autoCapitalize="none" autoCorrect={false} secureTextEntry={!showToken} editable={!busy} />
    <View style={{ alignItems: "flex-start", marginTop: -16, marginBottom: 20 }}>
      <Action label={showToken ? "Hide token" : "Show token"} small onPress={() => setShowToken(!showToken)} />
    </View>
    <View style={{ borderLeftWidth: 2, borderLeftColor: t.rule, paddingLeft: 14, marginBottom: 24 }}>
      <Txt muted style={{ fontSize: 13, lineHeight: 20 }}>{Platform.OS === "web"
        ? "Web stores your token in this browser’s localStorage, not an encrypted vault. Use a trusted browser on a device you control."
        : "Your token is stored in this device’s secure Keychain. Disconnect to remove it."}</Txt>
    </View>
    {message || configError || invalid ? <Txt accessibilityRole={error || configError || invalid ? "alert" : undefined} accessibilityLiveRegion="polite"
      style={{ color: error || configError || invalid ? t.accent : t.ink, marginBottom: 22 }}>{message || configError || "Invalid connection link. Paste your hub URL and token above."}</Txt> : null}
    <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
      <Action label={busy ? "Connecting…" : "Connect"} primary disabled={busy || !ready} onPress={() => void connect(true)} />
      <Action label="Test connection" disabled={busy || !ready} onPress={() => void connect(false)} />
    </View>
    <View style={{ borderTopWidth: 1, borderTopColor: t.rule, paddingTop: 22, marginTop: 38, gap: 12 }}>
      <Label>Start with a sample</Label>
      <Txt muted style={{ fontSize: 14 }}>Explore a fictional person’s shared memory. Demo captures stay in this session and never reach a hub.</Txt>
      <View style={{ alignItems: "flex-start" }}><Action label="Open Demo" disabled={busy || !ready} onPress={() => void connect(true, true)} /></View>
    </View>
    {connected ? <View style={{ marginTop: 24, alignItems: "flex-start" }}><Action label="Disconnect" disabled={busy} onPress={() => void leave()} /></View> : null}
    {incoming ? <Action label="Discard connection link" onPress={() => setIncoming(null)} /> : null}
    <Txt muted style={{ fontSize: 12, lineHeight: 19, marginTop: 26 }}>Find your URL, token, and private connection link with mh remote setup on the machine that curates your memory.</Txt>
  </View></Page>;
}
