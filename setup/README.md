# Agent setup

`mh init` registers Metaharness with detected Claude Code, Codex, Gemini CLI and Antigravity installations, adds a marker-bounded brief to their global instructions, and installs the `know-me` skill. Restart the agent after installation. Run `mh install` after adding another agent.

The name comes from `state/config.json`, set by `mh init --name "Your Name"`. Templates in this directory use `{{NAME}}` and `{{MH}}`; installation renders ready-to-paste copies into `build/setup/`.

## Interview

In Claude Code, run `/know-me` after restarting. Other agents can use the installed skill or follow `build/setup/know-me.SKILL.md` when you say “interview me”. The interview reads your existing context, asks one question at a time and records useful facts with `remember`.

Existing skills with the same name are preserved unless they carry Metaharness's generated marker. A rendered copy is always available in `build/setup/`.

## Claude on the web or phone

Set up the [cloud hub](../remote/README.md), then add its `/mcp/<token>` URL as a custom connector in claude.ai. Enable the connector in the conversation. Paste `build/setup/claude-personal-preferences.md` into personal preferences, or use `build/setup/claude-project-instructions.md` in a dedicated project for interviews.

## ChatGPT GPT

Follow the [cloud hub instructions](../remote/README.md) to import `/openapi.json` as a GPT action with Bearer authentication. Paste `build/setup/chatgpt-gpt-instructions.md` into the GPT's instructions. Start a conversation with the GPT and ask it to read your context.

## Edited files

- Claude Code: `~/.claude.json`, `~/.claude/CLAUDE.md`, `~/.claude/skills/know-me/SKILL.md`.
- Codex: `~/.codex/config.toml`, `~/.codex/AGENTS.md`, `~/.agents/skills/know-me/SKILL.md`.
- Gemini CLI: `~/.gemini/settings.json`, `~/.gemini/GEMINI.md`, `~/.gemini/skills/know-me/SKILL.md`.
- Antigravity: `~/.gemini/antigravity/mcp_config.json`, `~/.gemini/GEMINI.md`, `~/.gemini/antigravity/skills/know-me/SKILL.md`.

Original versions are saved in `state/backups/` before the first edit. `mh uninstall` removes the brief blocks; it leaves MCP entries and skills in place for manual removal if you stop using Metaharness.
