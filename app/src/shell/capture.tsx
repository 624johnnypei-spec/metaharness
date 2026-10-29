import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KINDS, type RememberKind } from "../../lib/types";
import { useApp } from "../state";
import { fonts, useTheme } from "../theme";
import { Action, Field, Label, Txt } from "../components/ui";

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
  const t = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  async function submit() {
    setBusy(true); setError("");
    try {
      const response = await client.remember(text, kind);
      setSuccess(response.result === "Already known." ? "Already known. Your hub already has this note."
        : credentials.token === "demo" ? "Demo capture saved for this session. Nothing was sent to a hub."
        : "Queued. Your agents can read this now. The curator’s next mh tick will import it locally.");
      refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save this note. Please try again."); }
    finally { setBusy(false); }
  }
  return <Modal visible transparent animationType="fade" onRequestClose={() => !busy && closeCapture()}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, justifyContent: width >= 700 ? "center" : "flex-end", alignItems: "center" }}>
      <Pressable accessible={false} onPress={() => !busy && closeCapture()} style={{ position: "absolute", inset: 0, backgroundColor: "#00000070" }} />
      <View accessibilityViewIsModal style={{ width: width >= 700 ? 560 : "100%", maxHeight: height - Math.max(insets.top, 32), backgroundColor: t.paper, borderWidth: 1, borderColor: t.rule }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: width >= 700 ? 32 : 24, paddingBottom: Math.max(insets.bottom, 24) }}>
          <View style={{ alignItems: "flex-end" }}><Action label="Close" small disabled={busy} onPress={closeCapture} /></View>
          <Label>{credentials.token === "demo" ? "Demo capture" : "Add to shared memory"}</Label>
          <Txt accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 38, lineHeight: 44, marginTop: 8, marginBottom: 26 }}>Worth remembering.</Txt>
          {success ? <>
            <Txt accessibilityLiveRegion="polite" style={{ marginBottom: 24 }}>{success}</Txt>
            <Action label="Done" primary onPress={closeCapture} />
          </> : <>
            <Field label="What should your agents remember?" placeholder="A preference, a goal, a little context…" value={text} onChangeText={setText} multiline autoFocus editable={!busy}
              style={{ minHeight: 110, textAlignVertical: "top" }} />
            <Label>Kind</Label>
            <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 8, marginBottom: 20 }}>
              {KINDS.map(item => <Pressable key={item} accessibilityRole="radio" accessibilityLabel={item} accessibilityState={{ checked: kind === item }} aria-checked={kind === item} disabled={busy} onPress={() => setKind(item)}
                style={{ paddingVertical: 10, paddingHorizontal: 10, borderBottomWidth: 2, borderBottomColor: kind === item ? t.ink : t.rule }}>
                <Txt style={{ fontSize: 13, color: kind === item ? t.ink : t.muted, textTransform: "capitalize" }}>{item}</Txt>
              </Pressable>)}
            </View>
            <Txt muted style={{ fontSize: 13, lineHeight: 20, marginBottom: 20 }}>Saved with source “app”. Queued for your curator’s next mh tick.</Txt>
            {error ? <Txt accessibilityRole="alert" style={{ color: t.accent, marginBottom: 18 }}>{error}</Txt> : null}
            <Action label={busy ? "Saving…" : "Remember this"} primary disabled={busy || !text.trim()} onPress={() => void submit()} />
          </>}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
