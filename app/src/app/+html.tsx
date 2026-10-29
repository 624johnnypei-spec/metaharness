import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";
export default function Root({ children }: PropsWithChildren) {
  return <html lang="en"><head>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="referrer" content="no-referrer" />
    <title>Metaharness</title>
    <meta name="description" content="One shared memory for your AI agents. Read, search, and remember." />
    <meta name="theme-color" content="#F3F0E8" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#0F0F0D" media="(prefers-color-scheme: dark)" />
    <ScrollViewStyleReset />
  </head><body>{children}</body></html>;
}
