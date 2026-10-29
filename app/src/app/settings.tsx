import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Platform, useWindowDimensions, View } from "react-native";
import { HubClient } from "../../lib/api";
import { validateCredentials } from "../../lib/links";
import { useApp } from "../state";
import { useTheme } from "../theme";
import { Action, Field, Group, Page, PageHeader, Row, Txt } from "../components/ui";
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
  const wide = useWindowDimensions().width >= 900;
  const { invalid } = useLocalSearchParams<{ invalid?: string }>();
  const connected = Boolean(credentials.token);
  useEffect(() => {
    if (ready) {
      setUrl((incoming ?? credentials).url);
      setToken((incoming ?? credentials).token);
      setShowToken(false);
      setMessage(incoming ? "Connection link received" : "");
      setError(false);
    }
  }, [ready, credentials, incoming]);
  function fail(reason: unknown) {
    setError(true);
    setMessage(reason instanceof Error ? reason.message : "Connection failed. Try again.");
  }
  async function connect(save: boolean, demo = false) {
    setBusy(true); setMessage(""); setError(false);
    try {
      const value = validateCredentials(demo ? { url: "", token: "demo" } : { url, token });
      await new HubClient(value).context();
      if (save) { await configure(value); router.replace("/"); }
      else setMessage("Connected");
    } catch (reason) { fail(reason); }
    finally { setBusy(false); }
  }
  async function leave() {
    setBusy(true);
    try { await disconnect(); setUrl(""); setToken(""); setMessage(""); }
    catch (reason) { fail(reason); }
    finally { setBusy(false); }
  }
  return <Page grouped><View style={{ width: "100%", maxWidth: connected ? 680 : 440, alignSelf: "center", paddingTop: connected ? 0 : wide ? 68 : 42 }}>
    {!connected ? <View style={{ marginBottom: 24 }}><Mark /></View> : null}
    <PageHeader title={connected ? "Settings" : "Connect to your hub"} />
    <Group><View style={{ padding: 16, paddingBottom: 4 }}>
      <Field label="Hub URL" value={url} onChangeText={value => { setUrl(value); setMessage(""); }} placeholder="https://your-hub.example" autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!busy} />
      <Field label="Token" value={token} onChangeText={value => { setToken(value); setMessage(""); }} placeholder="Paste token" autoCapitalize="none" autoCorrect={false} secureTextEntry={!showToken} editable={!busy} />
      {Platform.OS === "web" ? <Txt muted style={{ fontSize: 12, lineHeight: 18, marginTop: -8 }}>Stored in this browser, without encryption.</Txt> : null}
      <View style={{ alignItems: "flex-end", marginTop: 2 }}><Action label={showToken ? "Hide token" : "Show token"} small onPress={() => setShowToken(!showToken)} /></View>
    </View></Group>
    {message || configError || invalid ? <Txt accessibilityRole={error || configError || invalid ? "alert" : undefined} accessibilityLiveRegion="polite" style={{ color: error || configError || invalid ? t.danger : t.muted, fontSize: 14, marginBottom: 16 }}>{message || configError || "Invalid connection link. Paste the URL and token."}</Txt> : null}
    <Action label={busy ? "Connecting…" : "Connect"} primary disabled={busy || !ready} onPress={() => void connect(true)} />
    <Action label="Test connection" disabled={busy || !ready} onPress={() => void connect(false)} style={{ marginTop: 4 }} />
    {!connected ? <Action label="Try with sample data" disabled={busy || !ready} onPress={() => void connect(true, true)} style={{ marginTop: 16 }} /> : <View style={{ marginTop: 24 }}>
      <Group><Row label="Mode" value={credentials.token === "demo" ? "Demo" : "Connected"} /><Row label="Token storage" value={Platform.OS === "web" ? "Browser" : "Keychain"} last /></Group>
      <Group><Action label="Disconnect" disabled={busy} onPress={() => void leave()} /></Group>
    </View>}
    {incoming ? <Action label="Discard connection link" onPress={() => setIncoming(null)} /> : null}
  </View></Page>;
}
