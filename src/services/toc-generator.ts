export function generateToc(markdown: string): string {
  const lines = markdown.split("\n");
  const entries: string[] = [];
  // CommonMark: a fence opens with 3+ backticks or tildes (0-3 spaces indent)
  // and closes only with the SAME character repeated at least as many times.
  let fence: { char: string; len: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) {
        fence = { char: marker[0], len: marker.length };
      } else if (marker[0] === fence.char && marker.length >= fence.len) {
        fence = null;
      }
      continue;
    }

    if (!fence && /^ {0,3}#{1,6}\s/.test(line)) {
      entries.push(`L${i + 1}: ${line.trimStart()}`);
    }
  }

  return entries.join("\n");
}
