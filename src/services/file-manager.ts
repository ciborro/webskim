import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export class FileManager {
  private baseDir: string;
  private lastTs: string = "";

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  generateFilename(url: string): string {
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/\./g, "_");

    // Process pathname: strip leading slash, extension, and normalize
    let path = decodeURIComponent(parsed.pathname)
      .slice(1)                                 // remove leading /
      .replace(/\.[^.]+$/, "")                  // strip file extension
      .replace(/[<>:"|?*\x00-\x1f]/g, "_")      // Windows-reserved BEFORE slash replace
      .replace(/\//g, "__");                    // slashes → __ separator (preserved)

    const MAX_SLUG = 150;
    if (path.length > MAX_SLUG) path = path.slice(0, MAX_SLUG);
    path = path.replace(/^_+|_+$/g, "");        // trim AFTER truncation

    const now = new Date();
    const pad = (n: number, len = 2) => String(n).padStart(len, "0");
    let ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(now.getMilliseconds(), 3)}`;

    // Guarantee uniqueness: if timestamp matches last one, increment by 1ms
    if (ts <= this.lastTs) {
      const lastMs = parseInt(this.lastTs.slice(-3), 10);
      ts = this.lastTs.slice(0, -3) + pad(lastMs + 1, 3);
    }
    this.lastTs = ts;

    const slug = path ? `${domain}__${path}` : domain;
    return `${ts}_${slug}.md`;
  }

  async savePage(content: string, url: string): Promise<{ filePath: string; fullContent: string }> {
    await mkdir(this.baseDir, { recursive: true });
    const filename = this.generateFilename(url);
    const filePath = join(this.baseDir, filename);
    const header = `<!-- Source: ${url} -->\n\n`;
    const fullContent = header + content;
    await writeFile(filePath, fullContent, "utf-8");
    return { filePath, fullContent };
  }
}
