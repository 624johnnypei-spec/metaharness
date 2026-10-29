import React, { useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { fonts, useTheme } from "../theme";

type MarkdownProps = { text: string; compact?: boolean };

function isTableDivider(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function tableCells(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** The small markdown vocabulary used by the hub's personal knowledge sections. */
export function Markdown({ text, compact = false }: MarkdownProps) {
  const theme = useTheme();
  const desktop = useWindowDimensions().width >= 900;
  const [linkError, setLinkError] = useState<string | null>(null);

  async function openLink(url: string) {
    if (!/^https?:\/\//i.test(url)) {
      setLinkError("This link is not a web address.");
      return;
    }
    try {
      setLinkError(null);
      await Linking.openURL(url);
    } catch {
      setLinkError("Could not open that link.");
    }
  }

  function inline(value: string, keyPrefix: string): React.ReactNode[] {
    const expression =
      /(\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\[([^\]]+)\]\(([^\s)]+)\)|\*([^*]+)\*|_([^_]+)_)/g;
    const nodes: React.ReactNode[] = [];
    let position = 0;
    let match: RegExpExecArray | null;
    while ((match = expression.exec(value)) !== null) {
      if (match.index > position)
        nodes.push(value.slice(position, match.index));
      const key = `${keyPrefix}-${match.index}`;
      if (match[2] || match[3]) {
        nodes.push(
          <Text key={key} style={{ fontWeight: "600" }}>
            {inline(match[2] || match[3], key)}
          </Text>,
        );
      } else if (match[4]) {
        nodes.push(
          <Text key={key} style={{ fontFamily: fonts.mono, fontSize: 14 }}>
            {match[4]}
          </Text>,
        );
      } else if (match[7] || match[8]) {
        nodes.push(<Text key={key} style={{ fontStyle: "italic" }}>{inline(match[7] || match[8], key)}</Text>);
      } else {
        const url = match[6];
        nodes.push(
          <Text
            key={key}
            accessibilityRole="link"
            onPress={() => void openLink(url)}
            style={{ color: theme.accent, textDecorationLine: "underline" }}
          >
            {match[5]}
          </Text>,
        );
      }
      position = match.index + match[0].length;
    }
    if (position < value.length) nodes.push(value.slice(position));
    return nodes;
  }

  const lines = text.replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  const body = {
    color: theme.ink,
    fontFamily: fonts.body,
    fontSize: desktop ? 16 : 17,
    lineHeight: desktop ? 24 : 26,
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || /^<!--/.test(line)) continue;

    const fence = line.match(/^(`{3,}|~{3,})/);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith(fence[1])) {
        code.push(lines[index]);
        index += 1;
      }
      blocks.push(
        <ScrollView key={`code-${index}`} horizontal style={{ marginVertical: 10, borderRadius: 8, borderWidth: 0.5, borderColor: theme.rule }}>
          <Text selectable style={[body, { fontFamily: fonts.mono, fontSize: 13, padding: 14 }]}>{code.join("\n")}</Text>
        </ScrollView>,
      );
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [line.replace(/^>\s?/, "")];
      while (index + 1 < lines.length && /^>\s?/.test(lines[index + 1].trim())) {
        index += 1;
        quote.push(lines[index].trim().replace(/^>\s?/, ""));
      }
      blocks.push(<View key={`quote-${index}`} style={{ borderLeftWidth: 2, borderLeftColor: theme.rule, paddingLeft: 14, marginVertical: 10 }}>
        <Text selectable style={[body, { color: theme.muted }]}>{inline(quote.join(" "), `quote-${index}`)}</Text>
      </View>);
      continue;
    }

    if (
      line.includes("|") &&
      index + 1 < lines.length &&
      isTableDivider(lines[index + 1])
    ) {
      const rows = [tableCells(line)];
      index += 2;
      while (
        index < lines.length &&
        lines[index].includes("|") &&
        lines[index].trim()
      ) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      index -= 1;
      blocks.push(
        <ScrollView key={`table-${index}`} horizontal style={styles.table}>
        <View style={{ minWidth: Math.max(360, rows[0].length * 150) }}>
          {rows.map((row, rowIndex) => (
            <View
              key={rowIndex}
              style={[styles.tableRow, { borderBottomColor: theme.rule }]}
            >
              {row.map((cell, column) => (
                <Text
                  key={column}
                  style={[
                    body,
                    styles.cell,
                    rowIndex === 0 && {
                      fontWeight: "600",
                      fontSize: 14,
                    },
                  ]}
                >
                  {inline(cell, `table-${index}-${rowIndex}-${column}`)}
                </Text>
              ))}
            </View>
          ))}
        </View>
        </ScrollView>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const bullet = line.match(/^([-*+]\s+|\d+[.)]\s+)(.*)$/);
    if (heading) {
      blocks.push(
        <Text
          key={index}
          accessibilityRole="header"
          selectable
          style={[
            styles.heading,
            {
              color: theme.ink,
              fontFamily: fonts.body,
              fontWeight: "600",
              fontSize:
                heading[1].length === 1
                  ? 24
                  : heading[1].length === 2
                    ? 20
                    : 17,
              marginTop: compact ? 8 : 16,
            },
          ]}
        >
          {inline(heading[2], `heading-${index}`)}
        </Text>,
      );
    } else if (bullet) {
      const marker = /^\d/.test(bullet[1]) ? bullet[1].trim() : "·";
      blocks.push(
        <View key={index} style={styles.bullet}>
          <Text style={[body, styles.marker, { color: theme.muted }]}>
            {marker}
          </Text>
          <Text selectable style={[body, styles.bulletText]}>
            {inline(bullet[2], `bullet-${index}`)}
          </Text>
        </View>,
      );
    } else if (/^([-*_])\1{2,}$/.test(line)) {
      blocks.push(
        <View
          key={index}
          style={[styles.rule, { backgroundColor: theme.rule }]}
        />,
      );
    } else {
      const paragraph = [line];
      while (
        index + 1 < lines.length &&
        lines[index + 1].trim() &&
        !/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>|`{3}|~{3}|[-*_]{3,}$)/.test(lines[index + 1].trim())
      ) {
        if (index + 2 < lines.length && isTableDivider(lines[index + 2])) break;
        paragraph.push(lines[index + 1].trim());
        index += 1;
      }
      blocks.push(
        <Text selectable key={index} style={[body, { marginBottom: compact ? 7 : 11 }]}>
          {inline(paragraph.join(" "), `p-${index}`)}
        </Text>,
      );
    }
  }

  return (
    <View style={{ minWidth: 0 }}>
      {blocks}
      {linkError ? (
        <Text style={[body, { color: theme.muted, marginTop: 8 }]}>
          {linkError}
        </Text>
      ) : null}
    </View>
  );
}

export default Markdown;

const styles = StyleSheet.create({
  heading: { marginBottom: 8 },
  bullet: { flexDirection: "row", gap: 8, marginBottom: 7 },
  marker: { minWidth: 13 },
  bulletText: { flex: 1 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 14 },
  table: { marginVertical: 8 },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
    paddingVertical: 10,
  },
  cell: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 21 },
});
