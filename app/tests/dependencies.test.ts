import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);

test("patched URL decoder retains Expo Router query parsing without recursive malformed decoding", () => {
  const query = require("query-string");
  assert.deepEqual({ ...query.parse("label=hello%20world&token=a%2Bb%2Fc") }, { label: "hello world", token: "a+b/c" });
  // A subprocess timeout also stops a future synchronous decoder regression.
  execFileSync(process.execPath, ["-e", "const q=require('query-string');if(typeof q.parse('input='+'%FE%FF'.repeat(4000)).input!=='string')process.exit(1)"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)), timeout: 2000, stdio: "pipe",
  });
});

test("patched Zod remains compatible with Expo's plugin and MCP command schemas", () => {
  const expo = dirname(require.resolve("expo/package.json"));
  const cli = dirname(require.resolve("@expo/cli/package.json", { paths: [expo] }));
  const { PluginSchema, DevToolsPluginOutputSchema } = require(join(cli, "build/src/start/server/DevToolsPlugin.schema.js"));
  const { createMCPDevToolsExtensionSchema } = require(join(cli, "build/src/start/server/createMCPDevToolsExtensionSchema.js"));
  const plugin = {
    packageName: "sample-plugin", packageRoot: "/sample", cliExtensions: {
      description: "Sample", entryPoint: "sample.js", commands: [{
        name: "sample", title: "Sample", environments: ["mcp"], parameters: [{ name: "count", type: "number" }],
      }],
    },
  };
  assert.equal(PluginSchema.safeParse(plugin).success, true);
  const schema = createMCPDevToolsExtensionSchema(plugin);
  assert.equal(schema.safeParse({ command: "sample", count: 2 }).success, true);
  assert.equal(schema.safeParse({ command: "sample", count: "invalid" }).success, false);
  assert.equal(schema.safeParse({ command: "sample", unrecognized: true }).success, false);
  assert.equal(DevToolsPluginOutputSchema.safeParse([{ type: "text", text: "Sample", level: "info" }]).success, true);
});
