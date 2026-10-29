# Remote memory

Choose one backend in your own account: Supabase, Cloudflare Workers + D1, or a self-hosted server. Each exposes the same memory protocol. Your computer harvests and distills; `mh tick` uploads the current memory and imports new remote notes. Local mode needs no account or server.

[SETUP.md](../SETUP.md) is the agent-driven setup guide. The commands below are the manual deployment details. Review your provider's plan and limits before creating resources; these instructions do not deploy anything automatically.

## Supabase

1. Create your own [Supabase project](https://supabase.com).
2. In its SQL editor, run [0001_metaharness.sql](supabase/migrations/0001_metaharness.sql). Its three tables enable RLS and grant access only to the edge function's service role.
3. Install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), then from the repository:

   ```sh
   cd remote
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase functions deploy metaharness --no-verify-jwt
   cd ..
   ```

   [config.toml](supabase/config.toml) also sets `verify_jwt = false`. The function checks its own shared token on private routes. Supabase supplies database credentials inside the function; never put its service-role or secret key in an agent configuration. See [function configuration](https://supabase.com/docs/guides/functions/function-configuration) and [function secrets](https://supabase.com/docs/guides/functions/secrets).

4. Configure the local client:

   ```sh
   ./mh remote setup --backend supabase --url https://YOUR_PROJECT_REF.supabase.co/functions/v1/metaharness
   ```

5. Run the printed SQL in the Supabase SQL editor. It stores only the token's SHA-256 hash in `mh_config`. Run `./mh tick` to upload your first brief.

## Cloudflare Workers + D1

The Worker and database belong to your Cloudflare account. The Worker has no runtime npm dependencies; it accesses D1 through the `DB` binding. Both cloud backends use [the same handler](shared/hub.ts).

1. Install [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) and sign in. From the repository:

   ```sh
   cd remote/cloudflare
   wrangler login
   wrangler d1 create metaharness
   ```

2. Put the returned `database_id` into [wrangler.toml](cloudflare/wrangler.toml). Keep `binding = "DB"`. If you change the database name, use that name in every command below.
3. Apply the schema and deploy:

   ```sh
   wrangler d1 execute metaharness --remote --file schema.sql
   wrangler deploy
   cd ../..
   ```

   These are remote writes to your account. For an offline preview, use `--local` instead of `--remote`, then `wrangler dev`. Cloudflare documents [D1 setup](https://developers.cloudflare.com/d1/get-started/) and [database bindings](https://developers.cloudflare.com/d1/worker-api/).

4. Configure the local client with the Worker URL printed by deployment:

   ```sh
   ./mh remote setup --backend cloudflare --url https://metaharness.YOUR_SUBDOMAIN.workers.dev
   ```

5. Run the printed SQL in the D1 console, or save it to a temporary file and use `wrangler d1 execute metaharness --remote --file <file>` from `remote/cloudflare`. Only the SHA-256 token hash is stored in `mh_config`. Run `./mh tick` to upload your first brief.

D1 is accessed through the Worker binding, not a public database endpoint. The same token check protects every private route.

## Self-hosted

Run the Python HTTP server on a machine you control. It needs Python 3.10+ and this repository; the server uses the standard library and a local SQLite database. You provide a stable HTTPS URL through your reverse proxy for phone clients.

1. On your main computer, generate the client configuration:

   ```sh
   ./mh remote setup --backend self-hosted --url https://memory.example.com
   ```

2. On the server, start the hub with the printed SHA-256 hash:

   ```sh
   ./mh serve --host 127.0.0.1 --port 8766 --token-sha256 HASH_FROM_SETUP
   ```

3. Point your HTTPS reverse proxy at `127.0.0.1:8766`, preserving paths, `Host`, and `Authorization`, and setting `X-Forwarded-Proto: https`. Keep a process supervisor running the server. The server stores memory in `state/hub.sqlite` and the hash in `state/server.json`; it does not need the raw client token.
4. Run `./mh tick` on your main computer. Use the HTTPS URL for Claude, ChatGPT, and remote agents.

For a local trial, use `http://127.0.0.1:8766` as the URL. Remote phone connectors need reachable HTTPS. Public tunnels are optional infrastructure you configure yourself.

## Tokens and configuration

`mh remote setup` generates a random token and saves it in owner-only `state/remote.json`. Backend, URL, and name live in `state/config.json`. Setup prints connector details and token-hash provisioning instructions; it does not log in or deploy for you. The public OpenAPI schema contains no personal data.

Setup also prints a private `metaharness://connect?url=...&token=...` link for the [control app](../app/README.md). Opening it fills the connection screen; test the connection before saving. The link contains the token, so keep it out of shared logs and screenshots. Python's standard library has no QR encoder; setup prints the link without adding a dependency.

Running setup again for the same backend and URL preserves the token. To rotate it, remove the token from `state/remote.json`, rerun setup, provision the new hash, and update your clients. Servers read the hash on every request, so the old token stops working immediately after the hash changes.

## Claude web and phone

In claude.ai, add a custom connector using the URL printed by setup:

```text
<HUB_URL>/mcp/<TOKEN>
```

Select it in your conversation and ask it to call `get_context`. Use `build/setup/claude-personal-preferences.md`, or `build/setup/claude-project-instructions.md` for an interview project. These are rendered by `mh init` or `mh install` with your configured name.

The connector URL is a credential. Keep it private, including in screenshots and logs. Connector availability depends on your account and client.

## ChatGPT custom GPT

Create a custom GPT and add an Action. Import its schema from `<HUB_URL>/openapi.json`. Set Action authentication to **API Key**, **Bearer**, and paste the token printed by setup. Paste `build/setup/chatgpt-gpt-instructions.md` into the GPT's instructions.

Test `getContext`, `remember`, and `searchMemory`, then use that GPT in the phone app. The Action belongs to this GPT; it does not add shared memory to ordinary ChatGPT conversations. Keep a personal memory GPT private. The schema declares saving a note consequential so the client can request confirmation.

## Other remote agents

Any MCP client, including Hermes, can connect to `<HUB_URL>/mcp` with `Authorization: Bearer <TOKEN>`. Clients that only accept a URL can use `/mcp/<TOKEN>`. Tools: `get_context`, `remember`, `search`, and `read_section`.

For a simple HTTP client, set `MH_HUB_URL` and `MH_HUB_TOKEN`, then:

```sh
curl "$MH_HUB_URL/context" -H "Authorization: Bearer $MH_HUB_TOKEN"
curl "$MH_HUB_URL/search?q=tea" -H "Authorization: Bearer $MH_HUB_TOKEN"
curl "$MH_HUB_URL/remember" \
  -H "Authorization: Bearer $MH_HUB_TOKEN" -H 'Content-Type: application/json' \
  -d '{"text":"Prefers tea","kind":"preference","source":"remote-agent"}'
```

New remote notes appear in hub context immediately. A sync writes them locally before acknowledging them on the next exchange. `mh tick` completes the local and remote refresh; `mh remote sync` pulls notes, then pushes the refreshed memory in a second exchange. Keep one local curator for each hub.

## Protocol and data

| Route | Purpose |
|---|---|
| `GET /context` | Brief plus remote notes awaiting sync |
| `GET /status` | `{last_sync, pending_notes}` from the stored brief and unacknowledged notes |
| `GET /search?q=...` | Keyword search |
| `POST /remember` | Save `{text, kind?, scope?, source?}` |
| `POST /sync` | Exchange `{files, ack}` for `{notes}` |
| `POST /mcp` or `/mcp/<token>` | MCP JSON-RPC |
| `GET /openapi.json` | Public GPT Action schema |

Every route except the schema requires the shared token. The hub stores the four curated files, brief, live journal digest, configured name, and remotely submitted notes. Anyone with the token can read or change that memory. No data is uploaded until you configure a remote backend and sync.

`last_sync` is the stored brief's upload timestamp, or `null` before the first upload. It is not an agent heartbeat. `pending_notes` counts remote notes awaiting acknowledgment by the curator. Reading status does not update either value. The app reads curated sections through the existing MCP `read_section` tool; there is no journal-list or agent-list route.

`mh forget` retires a local journal note. After a tick, it disappears from the uploaded digest; an already pulled remote note remains in the server's `mh_notes` table until deleted there. Forgetting does not remove wording already distilled into a curated file: edit that file too. To remove cloud copies entirely, delete the corresponding rows or database.

## Local verification

The cloud checks need Node 22.18+; the application itself does not. The protocol test executes the shared handler and both adapters, using actual SQLite for D1 SQL and a simulated Supabase query transport. It does not deploy or claim to test provider infrastructure.

```sh
node --disable-warning=ExperimentalWarning remote/tests/hub.test.mjs
tsc -p remote/cloudflare/tsconfig.json
# If Deno is installed:
deno check remote/supabase/functions/metaharness/index.ts
```
