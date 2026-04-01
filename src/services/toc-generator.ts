export function generateToc(markdown: string): string {
  const lines = markdown.split("\n");
  const entries: string[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("```") || line.startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (!inCodeBlock && /^#{1,6}\s/.test(line)) {
      entries.push(`L${i + 1}: ${line}`);
    }
  }

  return entries.join("\n");
}
