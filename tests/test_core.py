import hashlib
import json
import secrets
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

REPO = Path(__file__).resolve().parent.parent


class CoreSmoke(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="mh-test-")
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.repo, self.home = root / "repo with spaces", root / "home"
        self.repo.mkdir()
        self.home.mkdir()
        for name in ("metaharness", "setup", "launchd"):
            shutil.copytree(REPO / name, self.repo / name, ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copy2(REPO / "mh", self.repo / "mh")
        binaries = root / "bin"
        binaries.mkdir()
        (binaries / "python3").symlink_to(sys.executable)
        self.env = {"HOME": str(self.home), "PATH": f"{binaries}:/usr/bin:/bin",
                    "PYTHONDONTWRITEBYTECODE": "1", "PYTHONIOENCODING": "utf-8", "TZ": "UTC"}

    def run_cli(self, *args, input=None):
        result = subprocess.run(["./mh", *args], cwd=self.repo, env=self.env, input=input,
                                text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def python(self, script):
        result = subprocess.run([sys.executable, "-c", script], cwd=self.repo, env=self.env,
                                text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_cli_and_stdio(self):
        output = self.run_cli("init", "--name", "Test")
        self.assertIn("skipped (not installed)", output)
        self.assertFalse((self.home / ".claude").exists())
        config = json.loads((self.repo / "state/config.json").read_text())
        self.assertEqual(config, {"name": "Test", "backend": "local", "url": ""})
        self.run_cli("remember", "likes tea", "--kind", "preference", "--source", "test")
        self.assertIn("# Test — shared context", self.run_cli("context"))
        self.assertIn("likes tea", self.run_cli("search", "tea"))
        self.run_cli("tick")
        self.assertIn("1 live notes", self.run_cli("status", "-v"))
        messages = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "get_context", "arguments": {}}},
        ]
        output = self.run_cli("mcp", input="".join(json.dumps(m) + "\n" for m in messages))
        replies = [json.loads(line) for line in output.splitlines()]
        self.assertEqual([r["id"] for r in replies], [1, 2, 3])
        self.assertEqual({t["name"] for t in replies[1]["result"]["tools"]},
                         {"get_context", "remember", "search", "read_section"})
        self.assertIn("Test", replies[0]["result"]["instructions"])
        self.assertIn("likes tea", replies[2]["result"]["content"][0]["text"])
        self.assertIn("Test's AI agents", self.run_cli("distill", "--dry-run"))
        profile = self.repo / "self" / "profile.md"
        profile.write_text("# Profile\n\nCustom fact.\n")
        self.run_cli("init", "--name", "Renamed")
        self.assertEqual(profile.read_text(), "# Profile\n\nCustom fact.\n")
        self.assertIn("Renamed", self.run_cli("context"))
        self.assertIn("Renamed", (self.repo / "build/setup/chatgpt-gpt-instructions.md").read_text())

    def test_installed_agents_preserve_config(self):
        for directory in (".claude", ".codex", ".gemini/antigravity"):
            (self.home / directory).mkdir(parents=True)
        (self.home / ".claude.json").write_text('{"theme":"dark","mcpServers":{"other":{"command":"keep"}}}')
        (self.home / ".gemini/settings.json").write_text('{"theme":"dark"}')
        config = self.home / ".codex/config.toml"
        config.write_text('model = "keep"\n\n[mcp_servers.other]\ncommand = "keep"\n')
        instructions = self.home / ".codex/AGENTS.md"
        instructions.write_text("Keep this instruction.\n")
        self.run_cli("init", "--name", "Test")
        original = config.read_text()
        self.run_cli("install")
        self.assertEqual(config.read_text(), original)
        data = json.loads((self.home / ".claude.json").read_text())
        self.assertEqual(data["theme"], "dark")
        self.assertEqual(data["mcpServers"]["other"]["command"], "keep")
        self.assertTrue(instructions.read_text().startswith("Keep this instruction.\n"))
        self.assertEqual(instructions.read_text().count("<!-- metaharness:start -->"), 1)
        self.assertTrue(list((self.repo / "state/backups").glob("*.orig")))
        self.assertTrue((self.home / ".claude/skills/know-me/SKILL.md").is_file())
        self.run_cli("uninstall")
        self.assertIn("Keep this instruction.", instructions.read_text())
        self.assertNotIn("<!-- metaharness:start -->", instructions.read_text())

    def test_fake_agent_stores_end_to_end(self):
        self.run_cli("init", "--name", "Sam Sample")
        fixtures = {
            ".claude/projects/sample/memory/workshop.md": "---\nname: Workshop\ntype: preference\n---\nSam prefers a wide workbench.\n",
            ".codex/memories/memory_summary.md": "## User preferences\n- Sam likes pencil sketches.\n",
            ".gemini/GEMINI.md": "## Gemini Added Memories\n- Sam uses a folding stool.\n",
        }
        for name, content in fixtures.items():
            path = self.home / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        self.run_cli("remember", "Sam labels sample parts.", "--source", "cli")
        self.assertIn("harvested 3 new notes", self.run_cli("harvest"))
        self.run_cli("tick")
        notes = [json.loads(line) for line in (self.repo / "self/journal.jsonl").read_text().splitlines()]
        self.assertEqual({n["source"] for n in notes}, {"cli", "claude-code", "codex", "gemini"})
        self.assertIn("pencil sketches", self.run_cli("context"))
        self.assertIn("folding stool", self.run_cli("distill", "--dry-run"))
        request = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "search", "arguments": {"query": "wide workbench"}}}
        response = json.loads(self.run_cli("mcp", input=json.dumps(request) + "\n"))
        self.assertIn("wide workbench", response["result"]["content"][0]["text"])
        self.assertIn("harvested 0 new notes", self.run_cli("harvest"))

    def test_journal_revisions_and_distill_validation(self):
        self.run_cli("init", "--name", "Test")
        self.python('''from metaharness import core, distill
for text in ("likes tea", "likes coffee", "likes tea"):
    core.add_note(text, source="test", kind="preference", origin="test:memory")
assert [n["text"] for n in core.live_notes()] == ["likes tea"]
assert core.add_note("likes tea", source="test") is None
before = {name: core.read_curated(name) for name in core.CURATED}
try:
    distill._parse("=== profile.md ===\\nIncomplete")
except RuntimeError:
    pass
else:
    raise AssertionError("partial model output accepted")
assert before == {name: core.read_curated(name) for name in core.CURATED}
''')

    def test_authenticated_http(self):
        self.run_cli("init", "--name", "Test")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        token = secrets.token_urlsafe(32)
        digest = hashlib.sha256(token.encode()).hexdigest()
        process = subprocess.Popen(["./mh", "serve", "--port", str(port), "--token-sha256", digest], cwd=self.repo,
                                   env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(lambda: process.wait(timeout=5))
        self.addCleanup(process.terminate)
        token_path = self.repo / "state/server.json"
        for _ in range(100):
            if token_path.exists():
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                        break
                except OSError:
                    pass
            time.sleep(0.02)
        url = f"http://127.0.0.1:{port}"
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(url + "/context", timeout=5)
        self.assertEqual(caught.exception.code, 401)
        caught.exception.close()
        self.assertNotIn(token, token_path.read_text())
        self.assertIn(digest, token_path.read_text())
        self.assertEqual(token_path.stat().st_mode & 0o777, 0o600)
        headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(url + "/status", timeout=5)
        self.assertEqual(caught.exception.code, 401)
        caught.exception.close()
        with urllib.request.urlopen(urllib.request.Request(url + "/status", headers=headers), timeout=5) as response:
            self.assertEqual(response.headers["Cache-Control"], "no-store")
            self.assertIsNone(response.headers["Access-Control-Allow-Origin"])
            self.assertEqual(json.load(response), {"last_sync": None, "pending_notes": 0})
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(urllib.request.Request(url + "/status", data=b"{}", headers=headers), timeout=5)
        self.assertEqual(caught.exception.code, 405)
        caught.exception.close()
        request = urllib.request.Request(url + "/remember", data=b'{"text":"likes tea","kind":"preference"}', headers=headers)
        with urllib.request.urlopen(request, timeout=5) as response:
            self.assertIn("Saved", response.read().decode())
        with urllib.request.urlopen(urllib.request.Request(url + "/status", headers=headers), timeout=5) as response:
            self.assertEqual(json.load(response), {"last_sync": None, "pending_notes": 1})
        with urllib.request.urlopen(urllib.request.Request(url + "/context", headers=headers), timeout=5) as response:
            self.assertIn("likes tea", response.read().decode())
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(urllib.request.Request(url + "/remember", data=b"invalid", headers=headers), timeout=5)
        self.assertEqual(caught.exception.code, 400)
        caught.exception.close()

    def test_self_hosted_sync_round_trip(self):
        self.run_cli("init", "--name", "Server")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        url = f"http://127.0.0.1:{port}"
        client = self.repo.parent / "client"
        env = {**self.env, "MH_HOME": str(client)}

        def run(*args):
            result = subprocess.run(["./mh", *args], cwd=self.repo, env=env, capture_output=True,
                                    text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            return result.stdout

        run("init", "--name", "Test")
        setup_output = run("remote", "setup", "--backend", "self-hosted", "--url", url)
        token = json.loads((client / "state/remote.json").read_text())["token"]
        link = next(line.split(": ", 1)[1] for line in setup_output.splitlines() if line.startswith("Connect the app"))
        parsed = urllib.parse.urlsplit(link)
        self.assertEqual((parsed.scheme, parsed.netloc), ("metaharness", "connect"))
        self.assertEqual(urllib.parse.parse_qs(parsed.query), {"url": [url], "token": [token]})
        self.assertIn("url=http%3A%2F%2F", link)
        config = json.loads((client / "state/config.json").read_text())
        self.assertEqual(config, {"name": "Test", "backend": "self-hosted", "url": url})
        self.assertNotIn("url", json.loads((client / "state/remote.json").read_text()))
        digest = hashlib.sha256(token.encode()).hexdigest()
        process = subprocess.Popen(["./mh", "serve", "--port", str(port), "--token-sha256", digest],
                                   cwd=self.repo, env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(lambda: process.wait(timeout=5))
        self.addCleanup(process.terminate)
        for _ in range(100):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                    break
            except OSError:
                time.sleep(0.02)
        run("remember", "likes tea", "--kind", "preference", "--source", "test")
        run("tick")
        headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
        with urllib.request.urlopen(urllib.request.Request(url + "/context", headers=headers), timeout=5) as response:
            self.assertIn("likes tea", response.read().decode())
        with urllib.request.urlopen(urllib.request.Request(url + "/openapi.json", headers=headers), timeout=5) as response:
            spec = json.load(response)
        self.assertEqual(set(spec["paths"]), {"/context", "/search", "/remember", "/status"})
        with urllib.request.urlopen(urllib.request.Request(url + "/status", headers=headers), timeout=5) as response:
            status = json.load(response)
        self.assertEqual(status["pending_notes"], 0)
        self.assertIsInstance(status["last_sync"], str)
        request = urllib.request.Request(url + "/remember", data=b'{"text":"prefers green tea","kind":"preference","source":"phone"}', headers=headers)
        with urllib.request.urlopen(request, timeout=5) as response:
            self.assertIn("Saved", response.read().decode())
        run("tick")
        self.assertIn("prefers green tea", run("search", "green"))
        with urllib.request.urlopen(urllib.request.Request(url + "/status", headers=headers), timeout=5) as response:
            status = json.load(response)
        self.assertEqual(status["pending_notes"], 0)
        self.assertIsInstance(status["last_sync"], str)
        request = urllib.request.Request(url + "/mcp/" + token,
                                        data=b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
                                        headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=5) as response:
            tools = json.load(response)["result"]["tools"]
        self.assertEqual({t["name"] for t in tools}, {"get_context", "remember", "search", "read_section"})
        run("remote", "setup", "--backend", "self-hosted", "--url", url)
        self.assertEqual(json.loads((client / "state/remote.json").read_text())["token"], token)
        run("init", "--backend", "local")
        self.assertEqual(json.loads((client / "state/config.json").read_text())["backend"], "local")


if __name__ == "__main__":
    unittest.main()
