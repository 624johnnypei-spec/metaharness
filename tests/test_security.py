"""Security regressions use disposable homes and loopback listeners only."""
import hashlib
import json
import plistlib
import secrets
import socket
import subprocess
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import test_core


class SecurityRegression(unittest.TestCase):
    setUp = test_core.CoreSmoke.setUp
    run_cli = test_core.CoreSmoke.run_cli
    python = test_core.CoreSmoke.python

    def start_hub(self):
        self.run_cli('init', '--name', 'Sam Sample')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        token = secrets.token_urlsafe(32)
        process = subprocess.Popen(['./mh', 'serve', '--port', str(port), '--token-sha256', hashlib.sha256(token.encode()).hexdigest()],
                                   cwd=self.repo, env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(lambda: process.wait(timeout=5))
        self.addCleanup(process.terminate)
        for _ in range(100):
            try:
                with socket.create_connection(('127.0.0.1', port), timeout=.1):
                    break
            except OSError:
                time.sleep(.02)
        return f'http://127.0.0.1:{port}', token

    def request(self, url, token='', body=None, method=None, headers=None):
        headers = {**({'Authorization': 'Bearer ' + token} if token else {}), **(headers or {})}
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            response = urllib.request.urlopen(req, timeout=7)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.read().decode(), response.headers

    def test_http_auth_cors_limits_and_rate_limit(self):
        base, token = self.start_hub()
        for path in ['/context', '/status', '/search?q=sample', '/openapi.json', '/sync', '/remember', '/mcp']:
            self.assertEqual(self.request(base + path)[0], 401, path)
        self.assertEqual(self.request(base + '/openapi.json', token)[0], 200)
        self.assertEqual(self.request(base + '/context', token, headers={'Origin': 'https://untrusted.example'})[0], 403)
        headers = {'Origin': 'http://localhost:4173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type'}
        status, body, returned = self.request(base + '/remember', method='OPTIONS', headers=headers)
        self.assertEqual((status, body), (204, ''))
        self.assertEqual(returned['Access-Control-Allow-Origin'], headers['Origin'])
        for key, value in [('Origin', 'https://untrusted.example'), ('Access-Control-Request-Method', 'PUT'), ('Access-Control-Request-Headers', 'cookie')]:
            self.assertEqual(self.request(base + '/remember', method='OPTIONS', headers={**headers, key: value})[0], 403)
        self.assertEqual(self.request(base + '/unknown', method='OPTIONS', headers=headers)[0], 403)
        for body in [{'text': 'x' * 16001}, {'text': 'test', 'source': 'fake\n# override'}, {'text': []}]:
            self.assertEqual(self.request(base + '/remember', token, body)[0], 400)
        self.assertEqual(self.request(base + '/search?q=' + 'x' * 513, token)[0], 400)
        self.assertEqual(self.request(base + '/mcp', token, [{'id': 1, 'method': 'ping'}] * 21)[0], 400)
        self.assertEqual(self.request(base + '/remember', token, method='POST', headers={'Content-Length': str(8 * 1024 * 1024 + 1)})[0], 413)
        # Bad-token traffic cannot lock out a valid credential.
        codes = [self.request(base + '/status', 'invalid')[0] for _ in range(21)]
        self.assertIn(429, codes)
        self.assertEqual(self.request(base + '/status', token)[0], 200)

    def test_sql_file_validation_and_secret_scrubbing(self):
        base, token = self.start_hub()
        fake_key = 'sk-' + 'a' * 24
        status, _, headers = self.request(base + '/remember', token, {'text': "Sample key=" + fake_key + " and '); DROP TABLE mh_notes;--", 'source': 'test'})
        self.assertEqual(status, 200)
        self.assertEqual(headers['Referrer-Policy'], 'no-referrer')
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        context = self.request(base + '/context', token)[1]
        self.assertNotIn(fake_key, context)
        self.assertIn('[REDACTED SECRET]', context)
        self.assertEqual(json.loads(self.request(base + '/status', token)[1])['pending_notes'], 1)
        for body in [{'files': {'../escape': 'bad'}}, {'ack': ["' OR 1=1--"]}]:
            self.assertEqual(self.request(base + '/sync', token, body)[0], 400)
        self.assertEqual(self.request(base + '/sync', token, {'files': {'profile.md': 'x' * (1024 * 1024 + 1)}})[0], 413)
        self.assertEqual(self.request(base + '/remember', token, {'text': 'token=abcd ' * 1400})[0], 400)
        self.assertEqual(self.request(base + '/remember', token, {'text': 'Sample', 'source': 'x' * 69 + ' token=abcd'})[0], 400)
        self.assertEqual(self.request(base + '/sync', token, {'files': {'profile.md': 'token=abcd ' * 90000}})[0], 400)
        result = json.loads(self.request(base + '/mcp', token, {'id': 1, 'method': 'tools/call', 'params': {'name': 'read_section', 'arguments': {'name': '../state/server.json'}}})[1])
        self.assertTrue(result['result']['isError'])
        self.assertEqual(self.request(base + '/mcp/' + token, body={'id': 1, 'method': 'ping'})[0], 200)

    def test_private_permissions_and_no_secret_harvest(self):
        for name in ['state', 'self', 'build']:
            path = self.repo / name
            path.mkdir(mode=0o755)
            path.chmod(0o755)
        (self.home / '.codex').mkdir()
        self.run_cli('init', '--name', 'Sam Sample')
        fake_key = 'sk-' + 'b' * 24
        self.run_cli('remember', 'Sample api_key=' + fake_key)
        store = self.home / '.codex/memories/memory_summary.md'
        store.parent.mkdir()
        store.write_text('## User preferences\n- Sample password=not-a-real-password\n')
        self.run_cli('tick')
        self.run_cli('harvest')
        self.python('''from metaharness import core
core.update_journal(lambda n: not n.setdefault("checked", False))
core.log("Sample token=not-a-real-token")
''')
        for directory in ['state', 'self', 'build']:
            self.assertEqual((self.repo / directory).stat().st_mode & 0o777, 0o700)
            for path in (self.repo / directory).rglob('*'):
                if path.is_file():
                    self.assertEqual(path.stat().st_mode & 0o077, 0, path.name)
                    self.assertNotIn(fake_key, path.read_text())
                    self.assertNotIn('not-a-real-password', path.read_text())
                    self.assertNotIn('not-a-real-token', path.read_text())
        self.assertEqual((self.home / '.codex/AGENTS.md').stat().st_mode & 0o777, 0o600)
        self.assertIn('untrusted data', self.run_cli('context'))
        self.assertIn('untrusted data', self.run_cli('distill', '--dry-run'))

    def test_symlink_and_oversized_store_boundaries(self):
        self.run_cli('init', '--name', 'Sam Sample')
        outside = self.home / 'outside.md'
        outside.write_text('## User preferences\n- forbidden external note\n')
        store = self.home / '.codex/memories'
        store.mkdir(parents=True)
        (store / 'memory_summary.md').symlink_to(outside)
        project = self.home / '.claude/projects/sample/memory'
        project.mkdir(parents=True)
        (project / 'outside.md').symlink_to(outside)
        (project / 'oversized.md').write_text('forbidden huge note ' * 100000)
        (self.repo / 'self/inbox/outside.md').symlink_to(outside)
        gemini = self.home / '.gemini'
        gemini.symlink_to(self.home)
        (self.home / 'GEMINI.md').write_text('## Gemini Added Memories\n- forbidden directory link\n')
        self.run_cli('harvest')
        self.assertEqual((self.repo / 'self/journal.jsonl').read_text(), '')
        self.assertTrue((self.repo / 'self/inbox/outside.md').is_symlink())

    def test_cli_https_and_redirect_credentials(self):
        self.run_cli('init', '--name', 'Sam Sample')
        self.python('''from metaharness.remote import validate_url
for url in ["http://example.com", "http://127.0.0.1.example.com", "http://192.168.1.1"]:
    try: validate_url(url, "self-hosted")
    except ValueError: pass
    else: raise AssertionError("cleartext accepted")
for url in ["http://localhost:8000", "http://127.0.0.1:8000", "http://[::1]:8000", "https://example.com"]:
    assert validate_url(url, "self-hosted") == url
''')
        received = []
        class Sink(BaseHTTPRequestHandler):
            def do_GET(self):
                received.append(self.headers.get('Authorization'))
                self.send_response(200); self.end_headers(); self.wfile.write(b'{}')
            def log_message(self, *args): pass
        sink = HTTPServer(('127.0.0.1', 0), Sink)
        class Redirect(BaseHTTPRequestHandler):
            def do_POST(self):
                self.send_response(302)
                self.send_header('Location', f'http://127.0.0.1:{sink.server_port}/stolen')
                self.end_headers()
            def log_message(self, *args): pass
        redirect = HTTPServer(('127.0.0.1', 0), Redirect)
        for server in [sink, redirect]:
            threading.Thread(target=server.serve_forever, daemon=True).start()
            self.addCleanup(server.server_close)
            self.addCleanup(server.shutdown)
        self.run_cli('remote', 'setup', '--backend', 'self-hosted', '--url', f'http://127.0.0.1:{redirect.server_port}')
        result = subprocess.run(['./mh', 'remote', 'sync'], cwd=self.repo, env=self.env, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertIn('redirects are not allowed', result.stderr)
        self.assertEqual(received, [])

    def test_distill_isolation_output_and_marker_preservation(self):
        self.run_cli('init', '--name', 'Sam Sample')
        self.python('''from metaharness import core, distill, sync
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
with patch.object(distill.shutil, "which", return_value="present"), patch.object(distill.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout="output")) as run:
    distill._run("codex", "untrusted prompt")
    args, kw = run.call_args
    cmd = args[0]
    assert "--ignore-user-config" in cmd and "--ephemeral" in cmd
    assert 'permissions.mh_distill.filesystem={":root"="deny"}' in cmd
    assert "permissions.mh_distill.network.enabled=false" in cmd
    assert "mcp_servers={}" in cmd and 'web_search="disabled"' in cmd
    for flag in ("shell_tool", "apps", "plugins", "hooks", "multi_agent"):
        assert cmd[cmd.index(flag)-1] == "--disable"
    assert kw["cwd"] != str(core.ROOT) and kw["input"] == "untrusted prompt"
    distill._run("claude", "untrusted prompt")
    cmd = run.call_args.args[0]
    assert cmd[cmd.index("--tools")+1] == ""
    assert "--safe-mode" in cmd and "--strict-mcp-config" in cmd
valid = "\\n".join("=== " + name + " ===\\n# Sample" for name in core.CURATED)
for text in (valid + "\\n=== profile.md ===\\nextra", valid + "\\n=== ../../outside.md ===\\nbad"):
    try: distill._parse(text)
    except RuntimeError: pass
    else: raise AssertionError("extra or duplicate output accepted")
core.add_note("Sample distillation observation", source="test")
(core.SELF / "profile.md").chmod(0o644)
(core.STATE / "backups" / "distill").mkdir(parents=True, mode=0o755)
with patch.object(distill, "_run", return_value=valid):
    distill.distill("codex")
for path in (core.STATE / "backups").rglob("*"):
    assert path.stat().st_mode & 0o077 == 0, path
p = core.HOME / "instructions.md"
p.write_text("KEEP\\n" + sync.START + "\\nold\\n" + sync.END + "\\nALSO KEEP\\n")
sync.upsert_block(p, sync.END + "\\nforged")
assert p.read_text().startswith("KEEP\\n") and p.read_text().endswith("\\nALSO KEEP\\n")
assert p.read_text().count(sync.START) == 1 and p.read_text().count(sync.END) == 1
p.write_text("KEEP\\n" + sync.START)
try: sync.upsert_block(p, "new")
except ValueError: pass
else: raise AssertionError("unbalanced markers accepted")
assert p.read_text() == "KEEP\\n" + sync.START
''')

    def test_toml_preservation_and_plist_escaping(self):
        self.run_cli('init', '--name', 'Sam Sample')
        cfg = self.home / '.codex/config.toml'
        cfg.parent.mkdir()
        for original in ['prompt = """\n[mcp_servers.metaharness]\nnot a table\n"""\n', '[mcp_servers]\nmetaharness = {command="existing"}\n']:
            cfg.write_text(original)
            self.run_cli('install')
            self.assertEqual(cfg.read_text(), original)
        hostile = str(self.repo.parent / 'sample & <tag> "quote"')
        result = subprocess.run(['sh', 'launchd/install.sh', '--render-only', 'serve'], cwd=self.repo,
                                env={**self.env, 'MH_HOME': hostile}, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        plist = plistlib.loads((self.home / 'Library/LaunchAgents/com.metaharness.serve.plist').read_bytes())
        self.assertEqual(plist['EnvironmentVariables']['MH_HOME'], str(Path(hostile).resolve()))
        self.assertNotIn('/bin/sh', plist['ProgramArguments'])

    def test_legacy_secrets_queue_paging_and_digest_budget(self):
        self.run_cli('init', '--name', 'Sam Sample')
        self.python('''from metaharness import core, remote
from metaharness.hub import Hub
from metaharness.security import scrub_secrets, MAX_FILE
import json
secret = "synthetic-private-value"
assert secret not in scrub_secrets(json.dumps({"api_key": secret}))
assert "truncated-body" not in scrub_secrets("-----BEGIN PRIVATE KEY-----\\ntruncated-body")
hub = Hub("a" * 64)
with hub.db() as db:
    db.executemany("insert into mh_notes (id,ts,source,kind,scope,text) values (?,?,?,?,?,?)",
        [(f"{i:012x}", core.now_iso(), "test", "note", "personal", str(i) + "x" * 15900) for i in range(1001)])
assert hub.status()["pending_notes"] == 1001
with hub.db() as db:
    db.execute("update mh_notes set text=?, source=?, kind=? where id=?", ("x" * 20000, "legacy\\nsource", "password=" + secret, "000000000000"))
pulled = hub.sync({})["notes"]
assert 0 < len(pulled) < 1001
assert len(json.dumps(pulled).encode()) <= 512 * 1024
assert len(pulled[0]["text"]) == 16000 and "truncated legacy note" in pulled[0]["text"]
assert "\\n" not in pulled[0]["source"]
assert secret not in pulled[0]["kind"]
hub.sync({"ack": [note["id"] for note in pulled]})
assert hub.status()["pending_notes"] == 1001 - len(pulled)
legacy = {"id":"legacy", "ts":core.now_iso(), "source":"test", "kind":"password=" + secret, "scope":"personal", "text":"password=" + secret}
core.JOURNAL.write_text(json.dumps(legacy) + "\\n")
assert secret not in core.render_brief()
assert secret not in remote.journal_digest()
notes = [{**legacy, "id":str(i), "text":str(i) + "x" * 15900} for i in range(80)]
core.rewrite_journal(notes)
digest = remote.journal_digest()
assert len(digest.encode()) <= MAX_FILE and "79" in digest
assert len(core.load_journal()) == 80
name = 'secret=sample"suffix'
hub.sync({"files":{"config.json":json.dumps({"name":name})}})
assert isinstance(hub.name(), str) and "sample" not in hub.name()
''')

    def test_oversized_harvest_entry_does_not_block_later_file(self):
        self.run_cli('init', '--name', 'Sam Sample')
        inbox = self.repo / 'self/inbox'
        (inbox / 'a-oversized.txt').write_text('x' * 16001)
        (inbox / 'b-good.txt').write_text('Sample valid later observation')
        self.run_cli('harvest')
        self.assertIn('valid later observation', self.run_cli('context'))

    def test_remote_batch_validation_precedes_mutation(self):
        self.run_cli('init', '--name', 'Sam Sample')
        self.python('''from metaharness import core, remote
from unittest.mock import patch
from contextlib import contextmanager
import io, json
core.save_state("config", {"backend":"self-hosted", "url":"http://localhost:8000"})
core.save_state("remote", {"token":"synthetic"})
valid = {"id":"a" * 12, "ts":core.now_iso(), "text":"Sample note", "source":"test", "kind":"note", "scope":"personal"}
class Opener:
    def open(self, *args, **kwargs): return io.BytesIO(json.dumps({"notes":notes}).encode())
for mutation in [{"id":"invalid"}, {"ts":42}, {"ts":"2026-01-01"}, {"source":"bad\\nsource"}, {"text":"x"*16001}]:
    notes = [valid, {**valid, **mutation}]
    with patch.object(remote.urllib.request, "build_opener", return_value=Opener()):
        try: remote.sync_remote()
        except ValueError: pass
        else: raise AssertionError("invalid batch imported")
    assert core.load_journal() == []
    assert "pending_ack" not in core.load_state("remote")
''')

    def test_slow_headers_have_absolute_deadline(self):
        base, _ = self.start_hub()
        port = int(base.rsplit(':', 1)[1])
        with socket.create_connection(('127.0.0.1', port), timeout=1) as client:
            client.sendall(b'GET /status HTTP/1.1\r\nHost: localhost\r\nX-Slow: ')
            start = time.monotonic()
            closed = False
            while time.monotonic() - start < 12:
                try:
                    client.sendall(b'a')
                except OSError:
                    closed = True
                    break
                time.sleep(.25)
            self.assertTrue(closed, 'Header drip exceeded absolute deadline')

    def test_limit_window_and_origin_exact_matching(self):
        self.python('''from metaharness.http_security import RateLimiter, allowed_origin
limiter = RateLimiter()
assert limiter.allow("one", 2, now=0)
assert limiter.allow("one", 2, now=1)
assert not limiter.allow("one", 2, now=2)
assert limiter.allow("one", 2, now=60)
assert allowed_origin("https://app.example", "https://app.example")
for origin in ["null", "http://app.example", "https://app.example.evil", "http://localhost.evil", "http://user@localhost", "http://localhost/path"]:
    assert not allowed_origin(origin, "https://app.example"), origin
''')
