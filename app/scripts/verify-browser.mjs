import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(app, '..');
const scratch = await mkdtemp(join(tmpdir(), 'mh-app-check-'));
const output = join(app, 'verification');
await mkdir(output, { recursive: true });
const children = [];
let browser;
let privateToken = '';
let currentErrors = [];
async function port() {
  const server = createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const value = server.address().port;
  await new Promise(done => server.close(done));
  return value;
}
async function ready(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await fetch(url); return; } catch {}
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error('Local test server did not start.');
}
function cli(env, args) {
  try { return execFileSync('./mh', args, { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 }); }
  catch { throw new Error('A local hub verification command failed. Output withheld because setup contains credentials.'); }
}
function child(command, args, options) {
  const process = spawn(command, args, { stdio: 'ignore', ...options });
  children.push(process);
  return process;
}
try {
  const curatorHome = join(scratch, 'curator-home');
  const serverHome = join(scratch, 'server-home');
  const curator = join(scratch, 'curator');
  const server = join(scratch, 'server');
  await Promise.all([mkdir(curatorHome), mkdir(serverHome)]);
  const curatorEnv = { ...process.env, HOME: curatorHome, MH_HOME: curator };
  const serverEnv = { ...process.env, HOME: serverHome, MH_HOME: server };
  cli(curatorEnv, ['init', '--name', 'Sam Sample']);
  cli(serverEnv, ['init', '--name', 'Sample hub']);
  await writeFile(join(curator, 'self/profile.md'), '# Profile\n\nSam Sample is a fictional workshop volunteer used only for local verification.\n');
  await writeFile(join(curator, 'self/now.md'), '# Right now\n\nBuild a cardboard prototype of a reading stand.\n');
  await writeFile(join(curator, 'self/preferences.md'), '# Preferences\n\n- Use clear drawings.\n- Test the prototype before cutting wood.\n');
  await writeFile(join(curator, 'self/projects.md'), '# Projects\n\n## Reading stand\n\nA folding design for a sample community workshop.\n');
  cli(curatorEnv, ['remember', 'The sample prototype needs a wider base before the workshop.', '--source', 'codex', '--kind', 'project']);
  cli(curatorEnv, ['remember', 'Sam prefers clear drawings when reviewing a sample prototype.', '--source', 'claude-code', '--kind', 'preference']);
  cli(curatorEnv, ['remember', 'Compare two hinges on the sample prototype.', '--source', 'gemini', '--kind', 'note']);
  const hubPort = await port();
  const webPort = await port();
  const hub = `http://127.0.0.1:${hubPort}`;
  const site = `http://127.0.0.1:${webPort}`;
  const setup = cli(curatorEnv, ['remote', 'setup', '--backend', 'self-hosted', '--url', hub]);
  const { token } = JSON.parse(await readFile(join(curator, 'state/remote.json'), 'utf8'));
  privateToken = token;
  const link = setup.split('\n').find(line => line.startsWith('Connect the app'))?.split(': ').slice(1).join(': ');
  assert.equal(new URL(link).searchParams.get('token'), token);
  assert.equal(new URL(link).searchParams.get('url'), hub);
  const digest = createHash('sha256').update(token).digest('hex');
  child('./mh', ['serve', '--port', String(hubPort), '--token-sha256', digest], { cwd: repo, env: serverEnv });
  child(process.execPath, ['scripts/serve-web.mjs'], { cwd: app, env: { ...process.env, PORT: String(webPort) } });
  await Promise.all([ready(hub), ready(site)]);
  cli(curatorEnv, ['tick']);
  const headers = { Authorization: `Bearer ${token}` };
  browser = await chromium.launch({ headless: true });
  const reports = [];
  for (const mode of (process.env.VERIFY_MODE ? [process.env.VERIFY_MODE] : ['demo', 'local'])) for (const width of [390, 1440]) for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme });
    const page = await context.newPage();
    const errors = [];
    currentErrors = errors;
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const prefix = `${mode}-${width}-${colorScheme}`;
    const profileHeading = mode === 'demo' ? 'Profile' : 'About';
    async function screenshot(name) {
      await page.screenshot({ path: join(output, `${prefix}-${name}.png`), fullPage: true, animations: 'disabled' });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${prefix}/${name}: horizontal overflow`);
    }
    await page.goto(site);
    await expect(page.getByRole('heading', { name: 'Connect to your hub', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try with sample data', exact: true })).toBeVisible();
    await screenshot('onboarding');
    if (mode === 'demo') {
      await page.getByRole('button', { name: 'Try with sample data', exact: true }).click();
    } else {
      await page.getByRole('textbox', { name: 'Hub URL', exact: true }).fill(hub);
      await page.getByLabel('Token', { exact: true }).fill(token);
      await page.getByRole('button', { name: 'Test connection', exact: true }).click();
      await expect(page.getByText('Connected', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Connect', exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: 'Brief', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: profileHeading, exact: true })).toBeVisible();
    if (mode === 'demo') await expect(page.getByText('Demo', { exact: true }).first()).toBeVisible();
    await screenshot('brief');
    await page.getByRole('button', { name: profileHeading, exact: true }).click();
    await expect(page.getByRole('button', { name: profileHeading, exact: true })).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: profileHeading, exact: true }).click();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    await page.getByRole('tab', { name: 'Memory', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Memory', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preferences', exact: true })).toBeVisible();
    const sourceLabel = page.getByTestId('source-codex').first();
    await expect(sourceLabel).toBeVisible();
    const sourceColor = await sourceLabel.evaluate(element => ({
      background: getComputedStyle(element).backgroundColor,
      foreground: getComputedStyle(element.firstElementChild ?? element).color,
    }));
    assert.notEqual(sourceColor.background, 'rgba(0, 0, 0, 0)', 'Agent badges have a visible tint');
    await expect(page.getByTestId('provenance-time').first()).toBeVisible();
    await screenshot('memory');
    await page.getByRole('tab', { name: 'Search', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search terms', exact: true }).fill('prototype');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByText('now.md', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('source-codex').first()).toBeVisible();
    assert.deepEqual(await page.getByTestId('source-codex').first().evaluate(element => ({
      background: getComputedStyle(element).backgroundColor,
      foreground: getComputedStyle(element.firstElementChild ?? element).color,
    })), sourceColor, 'An agent has one consistent label color within a theme');
    await screenshot('search');
    if (width >= 900) {
      for (const shortcut of ['Meta+k', 'Control+k']) {
        await page.keyboard.press(shortcut);
        await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toBeHidden();
      }
    }
    await page.getByRole('button', { name: 'Remember', exact: true }).click();
    const note = `Sample browser capture ${width} ${colorScheme}: prefer clear workshop drawings.`;
    await page.getByRole('textbox', { name: 'Note', exact: true }).fill(note);
    await page.getByRole('radio', { name: 'preference', exact: true }).click();
    await screenshot('capture');
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await expect(page.getByText(mode === 'demo' ? 'Saved in Demo' : 'Queued for the next mh tick', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    if (mode === 'local') {
      assert.equal((await (await fetch(hub + '/status', { headers })).json()).pending_notes, 1);
      const before = await readFile(join(curator, 'self/journal.jsonl'), 'utf8').catch(() => '');
      assert.equal(before.includes(note), false, 'Capture must await curator import');
      cli(curatorEnv, ['tick']);
      const journal = (await readFile(join(curator, 'self/journal.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      assert.ok(journal.some(item => item.text === note && item.kind === 'preference' && item.source === 'app'));
      assert.equal((await (await fetch(hub + '/status', { headers })).json()).pending_notes, 0);
    }
    await page.getByRole('tab', { name: 'Status', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Status', exact: true })).toBeVisible();
    await expect(page.getByText('Last sync', { exact: true })).toBeVisible();
    await screenshot('status');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Status', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
    // Never capture settings screenshots after credentials are filled.
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Try with sample data', exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => localStorage.getItem('metaharness.connection.v1')), null);
    assert.deepEqual(errors, [], `${prefix}: unexpected browser errors`);
    reports.push({ mode, width, colorScheme, provenance: 'passed', shortcuts: width >= 900 ? 'passed' : 'not applicable', consoleErrors: errors.length, result: 'passed' });
    console.log(`PASS ${prefix}: onboarding, brief, memory, search, provenance, capture, status, reload, disconnect${width >= 900 ? ', keyboard shortcuts' : ''}; zero console errors`);
    await context.close();
  }
  await writeFile(join(output, 'browser-report.json'), JSON.stringify({ checks: reports, localCaptureTickRoundTrips: 4 }, null, 2) + '\n');
} catch (error) {
  // Playwright's rich assertion object includes input values; never print it.
  const message = String(error.message) + '\n' + currentErrors.join('\n');
  console.error(privateToken ? message.replaceAll(privateToken, '[redacted]') : message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const process of children) process.kill('SIGTERM');
  await rm(scratch, { recursive: true, force: true });
}
