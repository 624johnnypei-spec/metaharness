# Verification

Redesign verified locally on 2026-10-29. No release, login, push, or cloud build was performed.

| Check | Result |
| --- | --- |
| TypeScript | `npm run typecheck` passed |
| API, deep links, and provenance | 37 unit tests passed |
| Python hub | All 5 integration tests passed |
| Cloud hub adapters | Cloudflare and Supabase protocol suites passed |
| Web export | `npm run build:web` passed |
| iOS bundle | `npm run build:ios` passed; bytecode and assets exported |
| Dependency compatibility | `expo install --check` passed; native animation peers match SDK 57 |
| Native configuration | No permission usage descriptions, owner, or EAS project ID; tablet support and encryption declaration verified |
| Native shortcuts | Local Expo module autolinking, Swift parsing, and podspec syntax passed; hardware delivery not runtime-tested |
| Assets | Opaque RGB icon and both splash images are 1024 × 1024 |
| Browser | All 8 combinations passed: demo/local hub × 390/1440px × light/dark |
| Browser errors | Zero console errors and zero page errors across the matrix |
| Provenance | Real source labels and relative dates displayed; agent foreground/background colors match between Memory and Search |
| Desktop web shortcuts | Both Cmd+K and Ctrl+K open Remember in all four desktop cases |
| Local round trip | Four app captures imported into a separate curator journal by `mh tick`; source/kind verified and pending count acknowledged to zero |
| Privacy | Only the intended bundle identifier and 8 dependency metadata substring matches; no private data |
| UI source leftovers | No removed display fonts, uppercase eyebrow styles, numbered navigation, slogan strings, or period-ended screen titles |

The browser checks use fresh temporary HOME and MH_HOME directories, real HTTP requests to `mh serve`, and the exported static app. They seed fictional notes with actual source metadata, then cover onboarding, testing the connection, persistence, collapsible brief, refresh, curated sections, grouped search, provenance, capture, sync status, keyboard shortcuts, and disconnect. Screenshots were regenerated and visually inspected for both viewport sizes and color schemes; no horizontal page overflow was detected.

Requested screenshots in `verification/`:

- `demo-390-light-brief.png`
- `demo-390-dark-memory.png`
- `demo-1440-light-brief.png`
- `demo-390-light-onboarding.png`

Run the commands in [README.md](README.md) to reproduce. Screenshots, the browser matrix report, and the raw privacy and UI-leftover scans are local artifacts in ignored `verification/`. The privacy scan covered repository source/configuration/documentation and the lockfile, excluding Git internals and ignored dependencies/build artifacts. Lockfile matches were five random integrity strings and three parts of a dependency name.

The iOS export is a JavaScript/asset compilation, not a signed native build. Device Keychain access, OS delivery of links, native hardware shortcuts, dynamic type, and TestFlight on iPhone/iPad/Apple-silicon Mac still need release testing. Connection parsing and native route sanitization are unit-tested, including cold/warm delivery and malformed links.
