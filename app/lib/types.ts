export type Credentials = { url: string; token: string };

export const CURATED = ["profile.md", "now.md", "preferences.md", "projects.md"] as const;
export type CuratedSection = (typeof CURATED)[number];

// The shared hub protocol's complete list, in the same order as tools/list.
export const KINDS = [
  "event", "feedback", "goal", "health", "life", "note", "person", "preference",
  "profile", "project", "reference", "school", "tip", "user",
] as const;
export type RememberKind = (typeof KINDS)[number];
export type SearchGroup = { source: string; items: string[] };
export type Status = { last_sync: string | null; pending_notes: number };
export type RememberResponse = { result: string };
