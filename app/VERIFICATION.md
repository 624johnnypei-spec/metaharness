# Verification

Redesign, mark/timestamp follow-up, and security fixes verified locally on 2026-10-29. No release, login, push, or cloud build was performed. The repository audit and its limits are documented in [SECURITY.md](../SECURITY.md).

| Check | Result |
| --- | --- |
| TypeScript | `npm run typecheck` passed |
| App unit tests | 46 tests passed, including API, links, provenance, CSP, dependency compatibility, and native route sanitization |
| Python CLI, harvesters, MCP, hub | All 18 tests passed; temporary HOME, fake agent stores, both sync directions, auth, limits, symlinks, permissions, redirects, and slow-header deadlines |
| Cloud hub adapters | Cloudflare and Supabase protocol suites and 7 shared-security tests passed; atomic queue caps, legacy draining, and D1 request budgets covered |
| PostgreSQL | PGlite engine regression passed: both migrations, RLS role denial, bound SQL, and queue trigger |
| Cloud types/dependencies | Worker TypeScript and Deno 2.9.6 frozen-lockfile checks passed |
| Web export | `npm run build:web` passed |
| iOS bundle | `npm run build:ios` passed; bytecode and assets exported |
| Dependency compatibility | `expo install --check` passed; native animation peers match SDK 57 |
| Native configuration | Committed configuration has no owner/projectId or unused permission usage descriptions; ATS restricted to loopback, tablet support and encryption declaration verified. Private local EAS linking preserved with skip-worktree. |
| Native shortcuts | Local Expo module autolinking, Swift parsing, and podspec syntax passed; hardware delivery not runtime-tested |
| Assets | Shared five-dot geometry and real provenance colors; opaque RGB icon and both splash images are 1024 × 1024, favicon is 256 × 256; inspected at 29px and 1024px |
| Browser | All 8 combinations passed: demo/local hub × 390/1440px × light/dark |
| Browser errors | Zero console errors and zero page errors across the matrix |
| Browser security | Hostile raw HTML and executable Markdown links inert; credential URLs sanitized; no automatic connection; non-loopback HTTP rejected |
| Provenance | Real source labels and relative dates displayed; agent foreground/background colors match between Memory and Search |
| Missing timestamps | No placeholder update labels; demo Brief omits sync dates, local Brief shows real sync dates, and undated notes omit their date |
| Desktop web shortcuts | Both Cmd+K and Ctrl+K open Remember in all four desktop cases |
| Local round trip | Four app captures imported into a separate curator journal by `mh tick`; source/kind verified and pending count acknowledged to zero |
| Dependency audit | `npm audit --omit=dev`: 0 Critical/High/Moderate, 7 Low entries in Expo's build-time deepmerge chain; documented accepted risk |
| Privacy | Public content: intended bundle identifier and 8 dependency metadata substring matches only. One private local-only EAS owner line omitted from the artifact and excluded from the sanitized commit. |
| UI source leftovers | No removed display fonts, uppercase eyebrow styles, numbered navigation, slogan strings, or period-ended screen titles |

The browser checks use fresh temporary HOME and MH_HOME directories, real HTTP requests to `mh serve`, and the exported static app. They seed fictional notes with actual source metadata, then cover onboarding, testing the connection, persistence, collapsible brief, refresh, curated sections, grouped search, provenance, capture, sync status, keyboard shortcuts, and disconnect. They also check the five-dot logo, its 29px sidebar size, and the absence of missing-date placeholders. Screenshots were regenerated for both viewport sizes and color schemes; no horizontal page overflow was detected.

Requested screenshots in `verification/`:

- `demo-390-light-brief.png`
- `demo-390-dark-memory.png`
- `demo-1440-light-brief.png`
- `demo-390-light-onboarding.png`

Run the commands in [README.md](README.md) to reproduce. Screenshots, the browser matrix report, dependency audit JSON, and privacy/UI-leftover scans are local artifacts in ignored `verification/`. The privacy scan covered the whole non-ignored repository, excluding Git internals and ignored dependencies/build artifacts. Lockfile matches were five random integrity strings and three parts of a dependency name. The private working EAS configuration was preserved; the staged public configuration was checked separately and contains no owner/projectId.

The iOS export is a JavaScript/asset compilation, not a signed native build. Device Keychain access, OS delivery of links, native hardware shortcuts, dynamic type, and TestFlight on iPhone/iPad/Apple-silicon Mac still need release testing. Connection parsing and native route sanitization are unit-tested, including cold/warm delivery and malformed links.
