/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConnectLink, validateCredentials } from "../lib/links.ts";

test("connection links decode nested URLs and tokens exactly once", () => {
  const url = "https://example.invalid/functions/v1/metaharness";
  const token = "a+b/c=?&%value";
  const link = `metaharness://connect?${new URLSearchParams({ url, token })}`;
  assert.deepEqual(parseConnectLink(link), { url, token });
  assert.deepEqual(parseConnectLink("metaharness://connect?url=http%3A%2F%2F127.0.0.1%3A8123%2F&token=sample-token"), { url: "http://127.0.0.1:8123", token: "sample-token" });
});

test("URL validation preserves base paths and never falls back to a personal hub", () => {
  assert.deepEqual(validateCredentials({ url: " https://example.invalid/hub/// ", token: "sample-token" }), { url: "https://example.invalid/hub", token: "sample-token" });
  assert.deepEqual(validateCredentials({ url: "", token: "demo" }), { url: "", token: "demo" });
  for (const url of ["", "not a URL", "file:///tmp/hub", "javascript:alert(1)", "https://user:password@example.invalid", "https://example.invalid?token=secret", "https://example.invalid/#secret"]) {
    assert.throws(() => validateCredentials({ url, token: "sample-token" }));
  }
  for (const token of ["", " demo", "demo ", "sample\ntoken"]) assert.throws(() => validateCredentials({ url: "https://example.invalid", token }));
});

test("cleartext connections are restricted to exact loopback hosts", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(validateCredentials({ url: `http://${host}:8766`, token: "sample-token" }).url, `http://${host}:8766`);
  }
  for (const host of ["hub.example", "localhost.example", "localhost.", "192.168.1.2", "0.0.0.0", "[::ffff:192.168.1.2]"]) {
    assert.throws(() => validateCredentials({ url: `http://${host}`, token: "sample-token" }), /HTTPS/);
  }
});

test("oversized connection input is rejected without echoing it", () => {
  assert.throws(() => validateCredentials({ url: "https://example.invalid/" + "x".repeat(2048), token: "sample-token" }), /too long/);
  assert.throws(() => validateCredentials({ url: "https://example.invalid", token: "x".repeat(513) }), /too long/);
  assert.throws(() => parseConnectLink("metaharness://connect?" + "x".repeat(4096)), /Invalid connection link/);
});

test("invalid connection links fail without printing their original secret", () => {
  const token = "secret-for-test";
  const encoded = "url=https%3A%2F%2Fexample.invalid&token=" + token;
  const bad = [
    "not a link", `https://connect?${encoded}`, `metaharness://other?${encoded}`,
    `metaharness://connect/path?${encoded}`, `metaharness://user@connect?${encoded}`,
    `metaharness://connect:8123?${encoded}`, `metaharness://connect?${encoded}#fragment`,
    `metaharness://connect?${encoded}&token=another`, `metaharness://connect?${encoded}&url=https://other.invalid`,
    `metaharness://connect?${encoded}&extra=field`, "metaharness://connect?url=&token=sample-token",
    "metaharness://connect?url=https://example.invalid&token=", "metaharness://connect?url=https://example.invalid",
    "metaharness://connect?url=https://example.invalid&token=%ZZ", "metaharness://connect?url=file:///tmp/hub&token=sample-token",
  ];
  for (const link of bad) {
    assert.throws(() => parseConnectLink(link), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Invalid connection link/);
      assert.ok(!error.message.includes(token));
      return true;
    });
  }
});
