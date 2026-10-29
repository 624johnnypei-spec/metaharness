import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { CONTENT_SECURITY_POLICY } from "../lib/web-security.ts";

test("early browser guard removes URL credentials without connecting or persisting them", () => {
  const code = readFileSync(new URL("../public/security-bootstrap.js", import.meta.url), "utf8");
  for (const suffix of ["?token=sample-private&url=https://example.invalid", "#token=sample-private", "?toString=sample-private"]) {
    const location = new URL("https://app.example/connect" + suffix);
    const calls: unknown[][] = [];
    runInNewContext(code, { location, history: { replaceState: (...args: unknown[]) => calls.push(args) } });
    assert.deepEqual(calls, [[null, "", "/connect"]]);
    assert.ok(!JSON.stringify(calls).includes("sample-private"));
  }
});

test("CSP permits only the exact Expo hydration inline script", () => {
  const hash = createHash("sha256").update("globalThis.__EXPO_ROUTER_HYDRATE__=true;").digest("base64");
  const directive = CONTENT_SECURITY_POLICY.split(";").find(value => value.trim().startsWith("script-src"))!;
  assert.ok(directive.includes(`'sha256-${hash}'`));
  assert.ok(!directive.includes("unsafe-inline"));
  assert.ok(!directive.includes("unsafe-eval"));
  assert.ok(CONTENT_SECURITY_POLICY.includes("object-src 'none'"));
});

test("native ATS explicitly requires TLS except the three loopback hosts", () => {
  const config = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"));
  const ats = config.expo.ios.infoPlist.NSAppTransportSecurity;
  assert.equal(ats.NSAllowsArbitraryLoads, false);
  assert.deepEqual(Object.keys(ats.NSExceptionDomains).sort(), ["127.0.0.1", "::1", "localhost"]);
  for (const host of Object.keys(ats.NSExceptionDomains)) {
    assert.equal(ats.NSExceptionDomains[host].NSIncludesSubdomains, false);
    assert.equal(ats.NSExceptionDomains[host].NSExceptionAllowsInsecureHTTPLoads, true);
  }
});
