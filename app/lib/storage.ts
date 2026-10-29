import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { Credentials } from "./types.ts";
import { validateCredentials } from "./links.ts";

export const CREDENTIALS_KEY = "metaharness.connection.v1";
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

// Static web export also renders in Node, where browser storage is absent.
export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key, secureOptions);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, secureOptions);
}

export async function removeItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key, secureOptions);
}

export async function getCredentials(): Promise<Credentials> {
  const saved = await getItem(CREDENTIALS_KEY);
  if (saved) {
    try {
      const value: unknown = JSON.parse(saved);
      if (value && typeof value === "object" && "url" in value && typeof value.url === "string" &&
          "token" in value && typeof value.token === "string") {
        return validateCredentials({ url: value.url, token: value.token });
      }
    } catch {
      // Invalid or interrupted saves return to the connection screen.
    }
  }
  return { url: "", token: "" };
}

export async function saveCredentials(credentials: Credentials): Promise<void> {
  await setItem(CREDENTIALS_KEY, JSON.stringify(validateCredentials(credentials)));
}

export async function clearCredentials(): Promise<void> { await removeItem(CREDENTIALS_KEY); }

export const storage = { getItem, setItem, removeItem, getCredentials, saveCredentials, clearCredentials };
