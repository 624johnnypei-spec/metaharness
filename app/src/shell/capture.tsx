import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KINDS, type RememberKind } from "../../lib/types";
import { useApp } from "../state";
import { useTheme } from "../theme";
import { Action, Field, Txt } from "../components/ui";
import { IconButton } from "../components/icons";
import { Provenance } from "../components/provenance";

export function CaptureSheet() {
  const { capture } = useApp();
  return capture ? <CaptureForm /> : null;
}
function CaptureForm() {
  const { client, credentials, closeCapture, refresh } = useApp();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<RememberKind>("note");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const t = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= 700;
  async function submit() {
    setBusy(true); setError("");
    try {
      const response = await client.remember(text, kind);
      setSuccess(response.result === "Already known." ? "Already saved" : credentials.token === "demo" ? "Saved in Demo" : "Queued for the next mh tick");
      setSavedAt(response.result === "Already known." ? null : new Date().toISOString());
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Note not saved. Try again."); }
    finally { setBusy(false); }
  }
  return <Modal visible transparent animationType={Platform.OS === "ios" ? "slide" : "fade"} onRequestClose={() => !busy && closeCapture()}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: wide ? "center" : "flex-end", alignItems: "center" }}>
      <Pressable accessible={false} onPress={() => !busy && closeCapture()} style={{ position: "absolute", inset: 0, backgroundColor: "#00000055" }} />
      <View accessibilityViewIsModal style={{ width: wide ? 540 : "100%", maxHeight: height - Math.max(insets.top, 28), backgroundColor: t.surface, borderRadius: wide ? 14 : 20, borderBottomLeftRadius: wide ? 14 : 0, borderBottomRightRadius: wide ? 14 : 0, overflow: "hidden" }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 20, paddingRight: 8, minHeight: 60, borderBottomWidth: 0.5, borderColor: t.rule }}>
          <Txt accessibilityRole="header" style={{ flex: 1, fontSize: 18, fontWeight: "600" }}>Remember</Txt>
          <IconButton name="close" label="Close" disabled={busy} onPress={closeCapture} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: Math.max(insets.bottom, 20) }}>
          {success ? <>
            {savedAt ? <Provenance source="app" timestamp={savedAt} /> : null}
            <Txt accessibilityLiveRegion="polite" style={{ marginBottom: 24 }}>{success}</Txt>
            <Action label="Done" primary onPress={closeCapture} />
          </> : <>
            <Field label="Note" placeholder="Write a note" value={text} onChangeText={setText} multiline autoFocus editable={!busy} style={{ minHeight: 130, textAlignVertical: "top" }} />
            <Txt style={{ fontSize: 14, fontWeight: "500", marginBottom: 8 }}>Kind</Txt>
            <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
              {KINDS.map(item => <Pressable key={item} accessibilityRole="radio" accessibilityLabel={item} accessibilityState={{ checked: kind === item }} aria-checked={kind === item} disabled={busy} onPress={() => setKind(item)}
                style={({ pressed }) => ({ paddingVertical: 9, paddingHorizontal: 12, borderRadius: 8, backgroundColor: kind === item ? t.selection : t.grouped, opacity: pressed ? 0.6 : 1 })}>
                <Txt style={{ fontSize: 14, lineHeight: 20, color: kind === item ? t.accent : t.muted, fontWeight: kind === item ? "600" : "400" }}>{item.charAt(0).toUpperCase() + item.slice(1)}</Txt>
              </Pressable>)}
            </View>
            {error ? <Txt accessibilityRole="alert" style={{ color: t.danger, marginBottom: 16 }}>{error}</Txt> : null}
            <Action label={busy ? "Saving…" : "Save note"} primary disabled={busy || !text.trim()} onPress={() => void submit()} />
          </>}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
