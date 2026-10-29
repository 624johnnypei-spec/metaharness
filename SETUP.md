# Set up Metaharness

These instructions are for a coding agent working in this clone. When the user
says **"Follow SETUP.md"**, perform the setup and verify it. Do not just return
a checklist for the user to execute.

## 1. Ask for two choices

Check `state/config.json` first so you can reuse existing choices. Ask together:

- What name should the shared memory use? Default: `the user`.
- Where should memory be available? Default: **local only**. Offer the four
  options below, with their tradeoffs.

**Local only — recommended starting point.** No hosting account or hosting cost.
Claude Code, Codex, Gemini CLI/Antigravity, and local memory tools work on this
machine. Phone app connectors do not have an always-on endpoint. Add a hub later
without moving or replacing `self/`.

**Supabase — the user's project.** Uses Postgres and an edge function in the
user's Supabase account. The provider manages hosting; check its current free
tier and limits before creating resources. It supports Claude and ChatGPT phone
connections while the local machine is offline. Requires a Supabase login and
project, but no database key is given to agents.

**Cloudflare Workers + D1 — the user's account.** Uses a Worker and a D1 database
in the user's Cloudflare account. Check the account's current free-tier limits
and billing settings before creating resources. It provides the same always-on
phone connections through the Worker's HTTPS URL. Requires Cloudflare login and
the Wrangler CLI.

**Self-hosted — the user's always-on machine.** Runs the included Python
`mh serve` on an existing box, VPS, or tailnet-connected host. There is no
additional hosted service account; machine, domain, and network costs depend on
what the user already owns. Remote agents can use a private network. Claude and
ChatGPT need a publicly reachable HTTPS URL with a trusted certificate, because
their servers fetch the memory; putting only the user's phone on a tailnet is
not enough. The user operates the process, TLS, and backups.

Explain that all hubs are single-user copies of the same memory. Use one local
machine as curator. Hosting resources belong to the user; there is no shared
Metaharness account or hosted service to sign up for.

## 2. Check the environment

- Require macOS or Linux and Python 3.10+. Locate the CLIs the user actually uses.
- Use Python 3.11+ to install the Codex MCP integration automatically. Python
  3.10 still runs the other local commands; Codex TOML is left unchanged when
  safe parsing is unavailable or its representation cannot be edited safely.
- Read `./mh --help` and the selected backend's docs under [remote/](remote/README.md).
- Keep existing `self/`, `state/`, and agent settings. Do not invent personal
  facts, overwrite a populated profile, or copy another person's memory.
- Reuse existing authenticated provider tools. If a required login, account,
  host address, domain, or key cannot be obtained from the environment, ask only
  for what is missing. Have the user complete browser authentication rather
  than paste secrets into chat.
- Within the chosen backend, create and configure the resources in the user's
  account. Prefer available free tiers; explain and obtain approval before
  enabling a paid resource. Do not deploy to an unrelated account.

## 3. Configure the selected backend

### Local only

Run, substituting the chosen name:

```sh
./mh init --name "Your Name" --backend local
```

No provider login or network deployment is needed. Continue to verification.

### Supabase

Follow [the Supabase instructions](remote/README.md) using the user's project:

1. Create or select the project. Apply
   `remote/supabase/migrations/0001_metaharness.sql` using an authenticated SQL
   tool or the SQL editor.
2. From `remote/`, log in if necessary, link the project, and deploy the
   `metaharness` function with `--no-verify-jwt`. The included config also sets
   `verify_jwt = false`; the function validates its own shared token.
3. From the repository root, generate credentials for the deployed URL:

   ```sh
   ./mh remote setup --backend supabase --url https://PROJECT_REF.supabase.co/functions/v1/metaharness
   ```

4. Execute the printed `mh_config` SQL through the authenticated project. It
   stores only the token's SHA-256 hash. Keep the plaintext token in the local
   owner-only `state/remote.json`; do not put service-role credentials in agent
   configs.
5. Initialize integrations once the hub accepts the token:

   ```sh
   ./mh init --name "Your Name" --backend supabase --url https://PROJECT_REF.supabase.co/functions/v1/metaharness
   ```

### Cloudflare Workers + D1

Follow [the Cloudflare instructions](remote/cloudflare/README.md):

1. Use Wrangler to authenticate to the user's account. Create or select a D1
   database; put its ID in `remote/cloudflare/wrangler.toml` with binding `DB`.
2. Apply `remote/cloudflare/schema.sql` to that remote database. Deploy the
   Worker from `remote/cloudflare/` and obtain its HTTPS URL.
3. From the repository root, generate credentials:

   ```sh
   ./mh remote setup --backend cloudflare --url https://metaharness.SUBDOMAIN.workers.dev
   ```

4. Execute the printed `mh_config` SQL against the user's D1 database through
   Wrangler or the D1 console. Store only the hash on the server.
5. Initialize integrations:

   ```sh
   ./mh init --name "Your Name" --backend cloudflare --url https://metaharness.SUBDOMAIN.workers.dev
   ```

### Self-hosted

Use a code-only copy of this repository on the chosen always-on host, with a
private writable data directory. Do not transfer the local `self/` or secrets
as part of copying code; the first sync sends the intended memory snapshot.

1. Decide how clients reach the server. Use a private network or tunnel for
   remote agents. For Claude/ChatGPT phone connections, set up a public HTTPS
   reverse proxy to the server's loopback listener in the user's infrastructure.
2. On the local curator, generate credentials for that URL:

   ```sh
   ./mh remote setup --backend self-hosted --url https://memory.example.net
   ```

3. On the server, run `mh serve` with the SHA-256 digest printed by setup:

   ```sh
   MH_HOME="$HOME/.local/share/metaharness" ./mh serve \
     --host 127.0.0.1 --port 8766 --token-sha256 SHA256_FROM_SETUP
   ```

   Use the actual digest, not the token. The server stores the hash in
   `state/server.json` and the hub data in `state/hub.sqlite` within its data
   directory. Adjust the listener only when the chosen private network needs
   it. Keep the process running with the host's service manager; use absolute
   executable paths and the same `MH_HOME` in its service configuration.
   For a static web client, also set `MH_ALLOWED_ORIGINS` in the server process
   or service environment to the client's exact HTTPS origin, such as
   `https://app.example.net`. Multiple origins are comma-separated, without
   paths or trailing slashes. Loopback browser origins work for local testing.
   Configure the corresponding setting on cloud hubs using their backend docs.
4. On the local curator, initialize integrations:

   ```sh
   ./mh init --name "Your Name" --backend self-hosted --url https://memory.example.net
   ```

Client URLs require HTTPS except for `localhost` or loopback IP addresses.
Private LAN and tailnet addresses also need HTTPS; use a loopback SSH tunnel
when testing a remote server without TLS. Clients reject hub redirects, so
configure the final hub URL directly.

## 4. Verify the real setup

Run these on the local curator, using a clearly labeled, nonpersonal test note:

```sh
./mh remember "Metaharness setup check: local to hub" --kind note --source setup-check
./mh tick
./mh search "Metaharness setup check"
./mh status -v
```

Also verify the stdio MCP server: send `initialize`, `tools/list`, and a
`tools/call` for `get_context` to `./mh mcp`. Confirm the tools are exactly
`get_context`, `remember`, `search`, and `read_section`, and the context uses the
chosen name.

For a hub, test the actual deployed endpoint in both directions. In a shell with
tracing disabled, read its URL and token from the local files; never include the
token in a report or commit:

```sh
MH_HUB_URL=$(python3 -c 'import json; print(json.load(open("state/config.json"))["url"])')
MH_HUB_TOKEN=$(python3 -c 'import json; print(json.load(open("state/remote.json"))["token"])')
curl --fail --silent --show-error "$MH_HUB_URL/context" \
  -H "Authorization: Bearer $MH_HUB_TOKEN"
curl --fail --silent --show-error "$MH_HUB_URL/remember" \
  -H "Authorization: Bearer $MH_HUB_TOKEN" -H 'Content-Type: application/json' \
  -d '{"text":"Metaharness setup check: hub to local","kind":"note","source":"setup-check"}'
curl --fail --silent --show-error "$MH_HUB_URL/openapi.json" \
  -H "Authorization: Bearer $MH_HUB_TOKEN" -o build/openapi.json
./mh tick
./mh search "hub to local"
unset MH_HUB_TOKEN
```

Require the first response to contain the local test note and the final search
to contain the hub test note. Confirm unauthenticated `/context`, `/status`,
and `/openapi.json` requests return 401. The authenticated schema retrieval
above must succeed. Browser preflights do not contain a bearer token; verify
they succeed only for an allowed origin, route, method, and header set.

Then connect the user's phone client:

- Claude: configure `<hub-url>/mcp/<token>` and call `get_context`.
- ChatGPT custom GPT: paste the authenticated `build/openapi.json` response
  into the Action schema editor, configure API Key / Bearer authentication,
  and call `getContext`. Do not rely on unauthenticated URL import or put a
  token in the schema URL. Keep the GPT private.
- Use the personalized instructions in `build/setup/`. Set up these UI steps
  when browser access is available; ask the user only for a required login or a
  client-side action you cannot perform. Have the phone save a second setup
  note, then run `mh tick` and find it locally. A curl check proves the endpoint,
  not that the phone client's connector is enabled.

Retire test notes with `mh forget <id>` and run `mh tick` again. Retirement does
not erase the original local journal text, existing backups, or acknowledged
hub rows. Remove those copies separately if the user needs full removal.
Only the newest live journal entries fitting within 1 MiB are uploaded in the
remote digest; the full local journal remains available to local `mh search`.

## 5. Finish the handoff

- Show which agents were detected and configured. Explain that new sessions pick
  up the brief and skills; offer the `/know-me` interview next.
- Offer background sync. On macOS, `launchd/install.sh tick` schedules sync;
  add `distill` only if the user wants subscription-model calls. On Linux, use
  the user's scheduler with absolute paths. Server uptime and local sync are
  separate: the hub can answer while the curator is offline, but harvesting and
  distillation wait for that machine.
- For distill, require subscription login to Claude Code or Codex. Do not
  request an API key. Explain the allowance usage before a live distill call;
  `mh distill --dry-run` needs no model call.
- Confirm `state/config.json` records the chosen name, backend, and URL. Keep
  secrets in `state/remote.json`, which is private and gitignored. Do not commit
  `self/`, `state/`, `build/`, credentials, or deployment account identifiers.
- Explain that secret-pattern scrubbing is a safeguard, not a guarantee that
  arbitrary sensitive text is detected. Treat connector and app connection
  URLs as credentials; prefer bearer headers and redact URL paths in proxy logs.
- Report what actually passed: local CLI, stdio MCP, both hub directions, phone
  client, and any scheduled service. Name anything still unverified; do not
  claim a phone connection from curl alone.

See [SECURITY.md](SECURITY.md) for the threat model, accepted risks, and the
security review. Do not describe this review as certification.
