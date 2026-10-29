# Remote memory

Choose one backend in your own account: Supabase, Cloudflare Workers + D1, or a self-hosted server. Each exposes the same memory protocol. Your computer harvests and distills; `mh tick` uploads the current memory and imports new remote notes. Local mode needs no account or server.

[SETUP.md](../SETUP.md) is the agent-driven setup guide. The commands below are the manual deployment details. Review your provider's plan and limits before creating resources; these instructions do not deploy anything automatically.

## Supabase

1. Create your own [Supabase project](https://supabase.com).
2. In its SQL editor, run [0001_metaharness.sql](supabase/migrations/0001_metaharness.sql), then [0002_pending_limit.sql](supabase/migrations/0002_pending_limit.sql). Existing installations must also apply the second migration. The tables enable RLS and grant access only to the edge function's service role; the second migration serializes admission to the pending-note queue across function instances.
3. Install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), then from the repository:

   ```sh
   cd remote
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase functions deploy metaharness --no-verify-jwt
   cd ..
   ```

   [config.toml](supabase/config.toml) also sets `verify_jwt = false`. The function checks its own shared token on private routes. Supabase supplies database credentials inside the function; never put its service-role or secret key in an agent configuration. See [function configuration](https://supabase.com/docs/guides/functions/function-configuration) and [function secrets](https://supabase.com/docs/guides/functions/secrets).

   The function's [deno.json](supabase/functions/metaharness/deno.json) enables a frozen [deno.lock](supabase/functions/metaharness/deno.lock), including integrity hashes for the pinned Supabase SDK and its transitive npm dependencies. Run the frozen Deno check below before deployment. To intentionally update dependencies, change the import and run the same command with `--frozen-lockfile=false`, review the lockfile diff, then repeat the frozen check. Deployment-provider packaging and runtime integrity remain provider controls; this repository's frozen check verifies the local dependency graph.

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

`mh remote setup` generates a random token and saves it in owner-only `state/remote.json`. Backend, URL, and name live in `state/config.json`. Setup prints connector details and token-hash provisioning instructions; it does not log in or deploy for you. The OpenAPI schema requires the same bearer token as other data routes.

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

Create a custom GPT and add an Action. Fetch `<HUB_URL>/openapi.json` with your bearer header in a trusted local client, then paste the returned schema into the Action editor. A URL-only unauthenticated schema import will be rejected. Set Action authentication to **API Key**, **Bearer**, and paste the token printed by setup. Paste `build/setup/chatgpt-gpt-instructions.md` into the GPT's instructions.

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
| `GET /openapi.json` | Authenticated GPT Action schema |

Every data route, including the schema and status, requires the shared token. Browser preflight is the sole unauthenticated exception: it returns no memory and accepts only a known route, its supported method, approved headers and an approved origin. The hub stores the four curated files, brief, live journal digest, configured name, and remotely submitted notes. Anyone with the token can read or change that memory. No data is uploaded until you configure a remote backend and sync.

## Browser origins and resource limits

Local development permits canonical HTTP origins on `localhost`, `127.0.0.1`, and `[::1]`. To connect a published web app, set `MH_ALLOWED_ORIGINS` on the hub to a comma-separated list of its exact HTTPS origins, without paths or trailing slashes. Configure a Supabase function secret or a Cloudflare Worker variable, for example `https://memory-app.example`. Unlisted browser origins are rejected. Native apps and server clients do not need an Origin header.

Hub responses include `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and HTTPS HSTS (`max-age=31536000; includeSubDomains`). Preserve these through a reverse proxy. Configure the published static app host with the same transport/referrer protections and the CSP described in the app README; host-level response headers are outside the static JavaScript bundle.

Requests are limited to 8 MiB, each uploaded file to 1 MiB, notes to 16,000 Unicode characters, queries to 512 characters, and single-line metadata to 80 characters. MCP batches allow 20 messages; sync acknowledgments allow 1,000 note IDs. New notes are rejected when 1,000 notes are pending. Sync reads eight rows at a time and drains an ordered prefix of at most 256 notes and 512 KiB per exchange; status reports the full pending count, including older queues above those limits. Run additional ticks to drain a large queue. A Cloudflare invocation stops with a controlled 429 before exceeding 48 D1 queries (a D1 batch counts as one); use smaller MCP batches when a large queue needs repeated reads. This leaves room below the [D1 Free limit of 50 queries per invocation](https://developers.cloudflare.com/d1/platform/limits/). Each request receives a fresh database-query budget.

The cloud request-body reader counts bytes while streaming; it does not impose an application-owned wall-clock deadline on a stalled stream. It relies on the deployment provider's connection and invocation timeouts. Review those limits for the chosen plan and configure ingress/proxy timeouts where supported. The Python server separately enforces socket and absolute request/body deadlines; those Python protections do not apply to the cloud handlers.

Cloud handlers apply a per-peer, per-isolate ingress limit of 240 requests per minute before reading the token verifier, plus separate limits of 20 failed authentications and 120 authenticated requests. Failed attempts do not consume the authenticated bucket; the ingress ceiling is shared by callers with the same transport address, not the whole account. Cloudflare uses its edge-supplied client address; Supabase uses the transport peer, which can be a shared gateway. Forwarded address headers are not trusted. These bounded in-memory limits reset on isolate restart and do not replace provider-level abuse controls or spending limits.

Common secret formats are scrubbed on note/file writes and outbound memory reads. This is a best-effort guard, not permission to store credentials. Oversized legacy notes are returned with an explicit `[truncated legacy note]` suffix; legacy metadata is normalized to bounded single lines so an old malformed record cannot block queue draining. These read protections preserve the original database rows, which may still contain old secrets or oversized text and need separate owner cleanup. Memory is explicitly labeled untrusted data for agent consumers. Prefer `/mcp` with an Authorization header; `/mcp/<token>` remains a compatibility option. Configure infrastructure logs to omit or redact that path: application `no-store` and `no-referrer` headers cannot control provider access logs or previously shared links.

`last_sync` is the stored brief's upload timestamp, or `null` before the first upload. It is not an agent heartbeat. `pending_notes` counts remote notes awaiting acknowledgment by the curator. Reading status does not update either value. The app reads curated sections through the existing MCP `read_section` tool; there is no journal-list or agent-list route.

`mh forget` retires a local journal note. After a tick, it disappears from the uploaded digest; an already pulled remote note remains in the server's `mh_notes` table until deleted there. Forgetting does not remove wording already distilled into a curated file: edit that file too. To remove cloud copies entirely, delete the corresponding rows or database.

## Local verification

The cloud checks need Node 22.18+; the application itself does not. The protocol test executes the shared handler and both adapters, using actual SQLite for D1 SQL and a simulated Supabase query transport. It does not deploy or claim to test provider infrastructure.

```sh
node --disable-warning=ExperimentalWarning remote/tests/hub.test.mjs
node --experimental-strip-types --test remote/tests/security.test.mjs
tsc -p remote/cloudflare/tsconfig.json
# Deno 2.9.6 was used for verification; resolves only the locked npm versions:
deno check --config remote/supabase/functions/metaharness/deno.json --frozen-lockfile remote/supabase/functions/metaharness/index.ts
# Once cached, append --cached-only to require an offline check.
```

An optional migration regression runs the actual PostgreSQL engine locally through PGlite (no hosted database or login). It covers RLS role denial, parameterized values, both migrations, and the pending-note trigger. Install its pinned test-only dependency in a disposable directory:

```sh
mh_pg_test_dir=$(mktemp -d)
npm install --prefix "$mh_pg_test_dir" --no-audit --no-fund @electric-sql/pglite@0.5.13
node remote/tests/postgres.test.mjs "$mh_pg_test_dir/node_modules/@electric-sql/pglite/dist/index.js"
```

This single-process test does not substitute for provider integration or concurrent-session load testing.
