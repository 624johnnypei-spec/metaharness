# Metaharness

**One memory of you, shared by every AI agent you use.**

Each agent knows a different slice of your life.
You keep repeating your preferences, goals, and what changed since last time.

Metaharness keeps one shared brief in plain files. Agents read it, add what they learn,
and pick up context from each other.

```text
 Claude Code       Codex       Gemini / Antigravity
      |              |                 |
      +---- native memories / MCP -----+
                     |
                  harvest
                     v
              self/journal.jsonl <---- remember
                     |
                   distill
                     v
 profile.md + now.md + preferences.md + projects.md
                     |
                  mh tick
                     v
              build/brief.md
                     |
          +----------+------------------+
          v                             v
 Global agent instructions        Optional cloud hub
       + local MCP                Claude / ChatGPT / remote agents
```

## App

The [Metaharness app](app/README.md) connects to your own hub from iPhone, iPad,
Apple-silicon Mac (the same iOS build), or any computer through a static website.
Read the brief, browse and search memory, capture a note, and see actual sync status.
It includes a clearly labelled fictional demo. Run `cd app && npm ci && npm start`;
see the app README for static hosting and TestFlight release instructions.

## Quickstart · 5 minutes

Requires **macOS or Linux, Python 3.10+, and the CLIs for the agents you use**.
The local tools use only the Python standard library.
Automatic Codex MCP configuration needs **Python 3.11+** for safe TOML parsing;
on Python 3.10, that integration is left unchanged for manual configuration.

```sh
git clone https://github.com/YOUR_ACCOUNT/metaharness.git
cd metaharness
```

**With a coding agent:** open the clone in Claude Code, Codex, or another coding
agent and say **"Follow SETUP.md"**. It asks your name and where memory should
live, sets everything up in your own accounts, and checks both directions of
sync. Local-only is the default; hosting is optional.

**By hand:** start locally with:

```sh
./mh init --name "Your Name"
```

`init` creates your empty `self/` files, registers memory tools, and adds a brief
to installed agents. Missing agents are skipped. Your name, backend, and hub URL
live in `state/config.json`. Rerunning init preserves your memories.

Restart Claude Code and run **`/know-me`** for a short interview. It saves useful
facts as you answer. You can also edit the four Markdown files in `self/` yourself.

```sh
./mh tick
./mh context
```

Your agents now share the same context. Use `./mh` from the repository directory,
or put the repository on your `PATH` to use `mh` anywhere.

## Background sync

On macOS, opt into launchd jobs:

```sh
./launchd/install.sh
```

This installs `tick` every 30 minutes and `distill` at 03:30 in your system's local
timezone. To schedule only sync, use `./launchd/install.sh tick`.

Distill folds new observations into the four curated files using **`claude -p`**
or **`codex exec`**. Sign in to the chosen CLI with your subscription account first.
No API keys are needed. Preview with `./mh distill --dry-run`; choose Codex with
`./mh distill --engine codex`. These calls use your subscription allowance.
Distillation isolates the CLI from project instructions and configured tools;
an older CLI that does not support the isolation flags fails without rewriting
memory. Imported memory is data, not authorization to execute its instructions.

On Linux, run `mh tick` and optionally `mh distill` from your preferred scheduler.
Use absolute paths and make the agent CLIs available on its `PATH`.

## A hub for phone apps

Choose **your own Supabase project**, **Cloudflare Workers + D1 account**, or
**an always-on server running `mh serve`**. Each stores the latest synced brief
and queues new observations until your computer runs `mh tick`. There is no
Metaharness-hosted service.

Use [SETUP.md](SETUP.md) for agent-driven setup or [remote/README.md](remote/README.md)
for backend instructions. Provider accounts, free-tier limits, and any hosting
charges are yours.

- **Claude:** add the custom connector at `<hub-url>/mcp/<token>`.
- **ChatGPT:** retrieve `<hub-url>/openapi.json` with Bearer authentication, paste
  its JSON into the GPT Action schema editor, and configure Bearer auth for actions.
- Copy personalized instructions from `build/setup/` after `mh init` or
  `mh install`. Source templates live in [setup/](setup/).

Claude and ChatGPT connect from their servers, so the hub needs a publicly
reachable HTTPS URL. A private tailnet address alone does not connect those apps.
For the static web app, set `MH_ALLOWED_ORIGINS` on the hub to its exact HTTPS
origin, for example `https://app.example.net`; separate multiple origins with
commas. Loopback browser origins are allowed for local development. CORS does
not replace the bearer token.

## Remote agents

Hermes or another remote agent can use any hub, including `mh serve` on your own
always-on box or VPS. For a foreground local server:

```sh
./mh serve
```

It listens on `127.0.0.1:8766` by default and prints a new token once on first
interactive startup. Use an SSH tunnel or private network for remote agents, or
put it behind HTTPS for phone app connectors. The server stores only the token's
hash. [SETUP.md](SETUP.md) covers provisioning a hash before unattended startup.
Clients permit HTTP only for `localhost` or loopback IP addresses. A private
network address still requires HTTPS; an SSH tunnel can expose it on loopback.

All hub backends expose authenticated `/context`, `/status`, `/search`, `/remember`,
`/sync`, `/openapi.json`, and `/mcp` routes. Browser preflight requests are checked
for allowed origin, method, and headers without requiring a token. MCP exposes
`get_context`, `remember`, `search`, and `read_section`. On macOS,
`./launchd/install.sh tick distill serve` also keeps the local server running.

The uploaded journal digest contains the newest live entries that fit within
1 MiB. The complete local journal stays intact; use local `mh search` for older
entries that no longer fit in the hub's recent digest.

## Commands

| Command | What it does |
| --- | --- |
| `mh init --name "Your Name"` | Create your memory and install agent integrations |
| `mh init --name "Your Name" --backend <backend> --url <hub-url>` | Initialize with a chosen hub |
| `mh context` | Print the shared brief |
| `mh remember "likes tea" --kind preference --source cli` | Save a fact |
| `mh search tea` | Search curated files and journal notes |
| `mh status -v` | Show sources and pending note IDs |
| `mh forget <id>` | Retire a journal note |
| `mh harvest` | Import new observations from local agent stores and `self/inbox/` |
| `mh sync` | Render the brief and update local agent instructions |
| `mh tick` | Harvest, sync local agents, and exchange notes with the configured hub |
| `mh distill [--engine codex] [--dry-run]` | Fold observations into curated files |
| `mh install` | Register integrations and refresh the brief |
| `mh uninstall` | Remove managed brief blocks |
| `mh mcp` | Serve memory tools over stdio |
| `mh serve [--host 127.0.0.1] [--port 8766] [--token-sha256 <hash>]` | Run your own hub |
| `mh remote setup --backend <backend> --url <hub-url>` | Generate local hub credentials and setup instructions |
| `mh remote sync` | Exchange the brief and notes with the hub |

Backends: `local` (default), `supabase`, `cloudflare`, and `self-hosted`.

## Privacy & safety

- **`self/` is your data.** It contains your profile, current focus, preferences,
  projects, and journal. It is gitignored by default, along with `state/` and
  `build/`. Back it up somewhere private.
- Your local memory is plain files, with no telemetry. Agents receive the
  brief through their instructions or memory tools. Distill sends the curated
  files and selected notes to your chosen agent provider; enabling the hub also
  uploads memory to your chosen backend. The optional self-hosted hub uses SQLite
  for its synced copy and pending notes.
- Harvesters read agent memory stores. Instruction edits stay inside
  `<!-- metaharness:start -->` / `<!-- metaharness:end -->` markers. Existing
  integration files are backed up under `state/backups/` before the first edit.
- Distill snapshots the curated files under `state/backups/distill/` before
  rewriting them. Review `self/` after a run; model output can be wrong.
- Keep secrets out of memory. Treat hub connector URLs and local tokens as
  credentials. Pattern-based scrubbing reduces accidental credential sharing,
  but cannot identify every secret. URL credentials can enter client, proxy,
  or provider logs; prefer the Authorization header when supported.
- `forget` retires a journal note without erasing its stored text. Remove
  already-curated facts from `self/*.md` too, then sync again. Backups, previous
  agent copies, and acknowledged hub rows can retain old content. Delete those
  copies separately when needed, and rotate any credential that was shared.

See [SECURITY.md](SECURITY.md) for the threat model, storage protections, accepted
risks, vulnerability reporting, and audit results.

[MIT licensed](LICENSE).
