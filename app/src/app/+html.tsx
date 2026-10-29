import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";
import { CONTENT_SECURITY_POLICY } from "../../lib/web-security";
export default function Root({ children }: PropsWithChildren) {
  return <html lang="en"><head>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="referrer" content="no-referrer" />
    <meta httpEquiv="Content-Security-Policy" content={CONTENT_SECURITY_POLICY} />
    <script src="/security-bootstrap.js" />
    <title>Metaharness</title>
    <meta name="description" content="Metaharness control app" />
    <meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />
    <ScrollViewStyleReset />
  </head><body>{children}</body></html>;
}
