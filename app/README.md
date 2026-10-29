# Metaharness app

One Expo SDK 57 / Expo Router app for iPhone, iPad, the iOS app on Apple-silicon Macs, and static web. It reads your own hub; there is no hosted account or default server.

## Run locally

Use Node 22.13+ (Node 24 recommended), npm, and Python 3 for hub tests.

```sh
cd app
npm ci
npm start
# Or: npm run web / npm run ios
```

Enter the hub **base URL** and bearer token printed by `mh remote setup`, then test and connect. A Supabase URL includes `/functions/v1/metaharness`; a self-hosted or Cloudflare URL is usually the origin. The URL must serve the protocol, not a web app. For local web testing, serve both the app and hub over HTTP on loopback. For a phone or a published HTTPS web app, use a reachable HTTPS hub.

Native tokens use SecureStore / iOS Keychain with device-only accessibility. Web tokens use localStorage, with an explicit warning in the connection screen. Disconnect deletes the saved credential. The app has no analytics, remote fonts, or service worker caching of personal context. It sends bearer tokens in headers, never API URLs.

`mh remote setup --backend self-hosted --url https://your-hub.example` also prints a private `metaharness://connect?url=...&token=...` link. Open it on an installed native app to fill connection settings; test and connect to save. The link is a credential: do not share or log it. Native routing removes its query before navigation. There is no QR dependency in the Python standard library, so setup prints the link only.

Connection links never connect automatically. Custom URL schemes can be claimed by another installed app; manual token entry is safer on untrusted devices. Web does not accept credentials from URLs and removes query strings/fragments before the router starts. Do not put tokens in browser URLs: the initial request may already reach a static host's access logs. HTTPS is required except for exact loopback hosts (`localhost`, `127.0.0.1`, `::1`); the native ATS exceptions are restricted to those hosts too. Use `localhost` or `127.0.0.1` for browser loopback testing because browser CSP does not support IPv6 address literals.

**Try with sample data** sets the token to exactly `demo`. Only that exact value enables the clearly labelled fictional Sam sample; empty or invalid credentials never fall back to sample data. Demo notes last for the current app session and never reach a hub.

The interface uses system fonts, follows the system color scheme, and supports native text scaling. On a phone, use the header **+** button to remember a note. On desktop, use **Remember** in the toolbar or **Cmd/Ctrl+K**.

Native hardware shortcuts use the local `metaharness-shortcuts` Expo module. It is included in native builds; Expo Go keeps the touch controls available but does not include that module.

## Features and protocol

- Brief: `GET /context`, rendered Markdown, collapsible sections, refresh and actual last-sync time.
- Memory: the four curated files via authenticated MCP `read_section`; recent notes when exposed in the brief.
- Search: `GET /search?q=...`, grouped by source.
- Remember: `POST /remember`, the hub's full kind list, source `app`, with a queued confirmation until the curator's next `mh tick`.
- Status: authenticated `GET /status` returns `{last_sync, pending_notes}`. It reports actual hub state, not agent presence. Update older hubs to expose this route; the brief still works if sync metadata is unavailable.

Journal notes and search results show recorded agent names with deterministic source colors and relative dates. The app preserves the precision of the hub data: a date-only note is never presented as a precise time, and curated files without an author are labelled accordingly. Section sync stamps describe the uploaded brief, not an unrecorded edit time.

No task management or integrations outside the open-source hub protocol are included.

## Static web

```sh
npm run build:web
npm run preview
```

Upload the contents of `dist/` to any static host. Serve `/memory`, `/settings`, and other extensionless routes from their matching `.html` files (or use an `index.html` fallback); retain `_expo/`, assets, and the exported files. No Node server, build secrets, or environment variables are needed in production. Use HTTPS, a trusted host, and an HTTPS hub with CORS support. `npm run preview` is a loopback-only convenience server, not a production deployment.

Allow the web app's exact origin in the hub's `MH_ALLOWED_ORIGINS`. The exported HTML includes a restrictive script policy and no-referrer policy. Configure your static host with `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and a `Content-Security-Policy` matching `lib/web-security.ts` plus `frame-ancestors 'none'` (the latter requires an HTTP header). The loopback preview sets these headers. Keep `public/security-bootstrap.js` in the export. Browser storage remains readable to code served by the same origin: use a dedicated trusted origin, and disconnect on shared computers.

Direct dependency versions and the lockfile are pinned. Security overrides update the URL decoder and Expo tooling's Zod dependency without upgrading SDK 57; a small local CommonJS adapter lets `query-string` use the patched ESM decoder. Regression checks exercise router parsing and the actual Expo schemas. Run `npm audit --omit=dev` when updating dependencies. The remaining low-severity `deepmerge` advisory is in Expo's trusted local build configuration path, not the exported app; keep build configuration and plugins trusted until an upstream compatible fix is available.

## TestFlight release

Forks **must change `ios.bundleIdentifier` in `app.json`** to their own identifier before release. The provided identifier is reserved for the upstream app. Change the scheme too if installing alongside upstream. There is deliberately no EAS owner or project ID; initialize your own project.

The following steps are for the maintainer to run. Apple Developer membership and cloud build usage can have costs; check the applicable plans before release.

```sh
npx eas-cli init
npx eas-cli build -p ios --profile production --auto-submit
```

Follow EAS prompts for your account and signing credentials. Select/create the matching App Store Connect app; supply its Apple app ID in the production submit profile if required. The production profile uses store distribution and increments build numbers remotely. After processing, enable TestFlight testers and complete any required beta review / compliance details. This repository declares no non-exempt encryption and requests no camera, microphone, photo, or location permissions.

For Apple-silicon Macs, distribute the **same iOS build** and enable its availability for Mac in App Store Connect; this is not a separate macOS/Catalyst target. Test that iOS build through TestFlight on an Apple-silicon Mac before release. See [Apple's iOS-on-Mac guidance](https://developer.apple.com/documentation/apple-silicon/running-your-ios-apps-in-macos), [Expo's build setup](https://docs.expo.dev/build/setup/) and [iOS submission](https://docs.expo.dev/submit/ios/).

## Verification

```sh
npm run typecheck
npm test
npm run build:web
npm run build:ios
# Optional browser test dependency (once):
npx playwright install chromium
npm run test:browser
```

The browser check starts a static preview and an actual local `mh serve` with temporary HOME and MH_HOME directories. It initializes a fictional curator, connects through onboarding, checks demo and real data at 390px and 1440px in both color schemes, captures a note through the app, runs `mh tick`, and verifies the local journal and hub acknowledgment. It also checks provenance labels, consistent agent colors, both desktop keyboard shortcuts, console errors, overflow, refresh, search, and disconnect. Temporary credentials never enter the output. Screenshots go to ignored `verification/`.

`expo export -p ios` verifies the iOS JavaScript bundle and assets; it is not an Xcode compile, signed IPA, or device/TestFlight test. Native secure storage and OS deep-link delivery should also be exercised on a device before release.

The icon shows four agent dots in their provenance colors around one solid memory dot, on an opaque white 1024px canvas. The in-app logo and raster assets share geometry and colors from `lib/mark.ts`. The splash uses the same mark on a plain light or dark background. `python3 scripts/make-assets.py` regenerates the assets and 29px inspection images using Node and Pillow (Pillow is asset-authoring only, not an app dependency).
