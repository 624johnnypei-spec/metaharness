/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { parseConnectLink } from "../lib/links.ts";
import * as pending from "../src/pending-connection.ts";

// Node strips .ts, but cannot directly import Expo Router's special .tsx entry.
// Compile the actual entry without JSX or React Native mocks, inject its two
// pure dependencies, and exercise the exported system-link handler.
const source = readFileSync(new URL("../src/app/+native-intent.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const entry: { redirectSystemPath?: (event: { path: string; initial: boolean }) => string } = {};
new Function("require", "exports", compiled)((name: string) => {
  if (name === "../../lib/links") return { parseConnectLink };
  if (name === "../pending-connection") return pending;
  throw new Error("Unexpected native-intent dependency");
}, entry);
const redirect = entry.redirectSystemPath!;

test("cold and warm native links strip credentials before entering router state", () => {
  for (const initial of [true, false]) {
    const value = { url: "https://example.invalid/hub", token: "sample+token/with?reserved&symbols" };
    const path = `metaharness://connect?${new URLSearchParams(value)}`;
    let notifications = 0;
    const unsubscribe = pending.subscribeConnection(() => { notifications++; });
    const route = redirect({ path, initial });
    unsubscribe();
    assert.equal(route, "/connect");
    assert.ok(!route.includes(value.token));
    assert.ok(!route.includes("token="));
    assert.equal(notifications, 1);
    assert.deepEqual(pending.takeConnection(), value);
    assert.equal(pending.takeConnection(), undefined, "Credentials must be consumed only once");
  }
});

test("invalid native links expose only a safe marker and erase prior pending credentials", () => {
  pending.receiveConnection({ url: "https://example.invalid", token: "old-sample-token" });
  const route = redirect({ path: "metaharness://connect?url=bad&token=sample-private-token", initial: false });
  assert.equal(route, "/connect?invalid=1");
  assert.ok(!route.includes("sample-private-token"));
  assert.equal(pending.takeConnection(), null);
  assert.equal(pending.takeConnection(), undefined);
});

test("unrelated internal routes are preserved without pending credentials", () => {
  assert.equal(redirect({ path: "/memory", initial: false }), "/memory");
  assert.equal(pending.takeConnection(), undefined);
});

test("unsupported incoming URLs cannot leak credentials into router state", () => {
  for (const path of ["/connect?token=sample-secret&url=https://example.invalid", "https://example.invalid/connect?token=sample-secret", "/connect#token=sample-secret", "/connect?to%6ben=sample-secret", "https://example.invalid/private-path"]) {
    assert.equal(redirect({ path, initial: false }), "/connect?invalid=1");
    assert.equal(pending.takeConnection(), null);
  }
});
