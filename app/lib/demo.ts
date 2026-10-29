import type { CuratedSection, SearchGroup } from "./types.ts";

// Entirely fictional. Nothing here is imported from a configured hub.
export const demoSections: Record<CuratedSection, string> = {
  "profile.md": "# Profile\n\nSam is a fictional sample person, a furniture maker who also builds small software tools.\n\n- Enjoys working with wood, drawing, and long walks.\n- Learns best by making a small working version first.\n- Keeps a notebook of ideas for the next workshop session.",
  "now.md": "# Right now\n\nSam is designing a folding reading stand for a community workshop.\n\n## This week\n\n- Make a cardboard prototype before cutting wood.\n- Compare two hinge designs.\n- Write a short assembly guide with clear drawings.",
  "preferences.md": "# Preferences\n\n- Start with the answer, then explain the choices.\n- Use plain language and concrete examples.\n- Ask before adding a paid service.\n- Prefer a few useful tools over a complicated setup.\n\n> A small working version is a good place to start.",
  "projects.md": "# Projects\n\n## Folding reading stand\n\nA lightweight stand that packs flat. The next step is a cardboard prototype.\n\n## Workshop notes\n\nA simple collection of illustrated guides for the community workshop.\n\n| Project | Current focus |\n| --- | --- |\n| Reading stand | Test hinge designs |\n| Workshop notes | Draw an assembly guide |",
};

export function demoContext(notes: string[] = []): string {
  return "# Sam — sample shared context\n\nThis is **Demo** content about a fictional person. It is not connected to a hub.\n\n" +
    Object.values(demoSections).map((section) => section.replace(/^# /, "## ").replace(/^## (?!Profile|Right now|Preferences|Projects)/gm, "### ")).join("\n\n") +
    (notes.length ? "\n\n## Demo captures\n\n" + notes.map((note) => `- ${note}`).join("\n") : "");
}

export function demoSearch(query: string, notes: string[]): SearchGroup[] {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu)?.filter((term) => term.length > 1) ?? [];
  if (!terms.length) return [];
  const documents = [...Object.entries(demoSections), ...notes.map((note) => ["Demo captures", note])] as [string, string][];
  const groups = new Map<string, string[]>();
  for (const [source, content] of documents) {
    for (const part of content.split(/\n(?=#{1,3} |- )/)) {
      if (terms.some((term) => part.toLowerCase().includes(term))) groups.set(source, [...(groups.get(source) ?? []), part.trim()]);
    }
  }
  return [...groups].map(([source, items]) => ({ source, items }));
}
