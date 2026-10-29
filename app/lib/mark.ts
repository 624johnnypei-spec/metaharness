import { sourceColors } from "./provenance.ts";

// Shared vector geometry for the native logo and every exported asset.
// Separate agent observations converge on one larger, neutral memory dot.
export const markGeometry = {
  size: 64,
  center: { x: 32, y: 32, radius: 10 },
  agents: [
    { source: "codex", x: 13, y: 18, radius: 4.25 },
    { source: "claude-code", x: 45, y: 10, radius: 3.75 },
    { source: "cli", x: 53, y: 44, radius: 4.25 },
    { source: "interview", x: 16, y: 51, radius: 3.75 },
  ],
};

export function markColors(dark: boolean) {
  return {
    center: dark ? "#FFFFFF" : "#000000",
    agents: markGeometry.agents.map(agent => sourceColors(agent.source, dark).foreground),
  };
}
