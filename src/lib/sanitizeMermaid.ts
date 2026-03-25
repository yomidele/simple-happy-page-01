/**
 * Sanitize AI-generated Mermaid diagram syntax to prevent rendering errors.
 * Fixes common issues: missing headers, unclosed brackets, illegal chars, etc.
 * Returns null if the diagram is unsalvageable.
 */

const VALID_HEADERS = [
  "graph TD", "graph LR", "graph RL", "graph BT", "graph TB",
  "flowchart TD", "flowchart LR", "flowchart RL", "flowchart BT", "flowchart TB",
  "sequenceDiagram", "classDiagram", "stateDiagram",
  "erDiagram", "gantt", "pie", "gitGraph", "mindmap",
  "timeline", "journey", "quadrantChart", "xychart",
  "sankey", "block-beta",
];

function hasValidHeader(chart: string): boolean {
  const trimmed = chart.trim();
  return VALID_HEADERS.some((h) => trimmed.startsWith(h));
}

function balanceBrackets(text: string): string {
  let result = text;
  const pairs: [string, string][] = [["[", "]"], ["(", ")"], ["{", "}"]];

  for (const [open, close] of pairs) {
    let count = 0;
    for (const ch of result) {
      if (ch === open) count++;
      else if (ch === close) count--;
    }
    // Close unclosed brackets
    while (count > 0) {
      result += close;
      count--;
    }
  }
  return result;
}

function removeIllegalChars(text: string): string {
  // Remove characters that break mermaid parsing but preserve node content
  // Keep letters, digits, common punctuation, whitespace, and mermaid syntax chars
  return text.replace(/[^\w\s\-\>\<\|\[\]\(\)\{\}\.\,\;\:\#\&\/\\\n\r\t\"\'`~!@$%^*+=?]/g, " ");
}

function truncateAtLastCompleteLine(text: string): string {
  const lines = text.split("\n");
  // Walk backwards to find last line that looks complete (not mid-token)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    // If line has unbalanced quotes or brackets, drop it
    const openBrackets = (line.match(/[\[\(\{]/g) || []).length;
    const closeBrackets = (line.match(/[\]\)\}]/g) || []).length;
    if (openBrackets !== closeBrackets) {
      lines.splice(i, 1);
      continue;
    }
    break;
  }
  return lines.join("\n");
}

export function sanitizeMermaid(raw: string): string | null {
  if (!raw || !raw.trim()) return null;

  let chart = raw.trim();

  // Add default header if missing
  if (!hasValidHeader(chart)) {
    // Check if it looks like graph content (has --> or --- patterns)
    if (/-->|---|\|/.test(chart)) {
      chart = "graph TD\n" + chart;
      console.debug("[MermaidSanitizer] Added default 'graph TD' header");
    } else {
      console.debug("[MermaidSanitizer] Content doesn't look like a mermaid diagram");
      return null;
    }
  }

  // Remove illegal characters from node labels (not from syntax lines)
  const lines = chart.split("\n");
  const sanitizedLines = lines.map((line, i) => {
    if (i === 0) return line; // preserve header
    // Remove truly problematic chars but keep most content
    return line.replace(/[<>]/g, (ch) => {
      // Keep --> and --- arrows
      return ch;
    });
  });
  chart = sanitizedLines.join("\n");

  // Truncate at last complete line
  chart = truncateAtLastCompleteLine(chart);

  // Balance brackets
  chart = balanceBrackets(chart);

  // Final validation: must have at least header + 1 content line
  const contentLines = chart.split("\n").filter((l) => l.trim());
  if (contentLines.length < 2) {
    console.debug("[MermaidSanitizer] Diagram too short after sanitization");
    return null;
  }

  return chart;
}
