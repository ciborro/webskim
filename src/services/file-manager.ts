import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export class FileManager {
  private baseDir: string;
  private lastTs: string = "";
  private collisionCounter = 0;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  generateFilename(url: string): string {
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/\./g, "_");

    // Process pathname: strip leading slash, extension, and normalize.
    // new URL() accepts malformed percent sequences like /%ZZ that decodeURIComponent
    // rejects; fall back to the raw pathname so generateFilename never throws URIError.
    let rawPath: string;
    try {
      rawPath = decodeURIComponent(parsed.pathname);
    } catch {
      rawPath = parsed.pathname;
    }
    let path = rawPath
      .slice(1)                                 // remove leading /
      .replace(/\.[^.]+$/, "")                  // strip file extension
      .replace(/[<>:"|?*\x00-\x1f]/g, "_")      // Windows-reserved BEFORE slash replace
      .replace(/\//g, "__");                    // slashes → __ separator (preserved)

    const MAX_SLUG = 150;
    if (path.length > MAX_SLUG) path = path.slice(0, MAX_SLUG);
    path = path.replace(/^_+|_+$/g, "");        // trim AFTER truncation

    const now = new Date();
    const pad = (n: number, len = 2) => String(n).padStart(len, "0");
    const baseTs = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(now.getMilliseconds(), 3)}`;

    let ts: string;
    // "_c" cannot appear in baseTs (digits + one underscore at pos 8), so split("_c")[0]
    // safely recovers the plain base regardless of whether a suffix was appended previously.
    const lastBaseTs = this.lastTs.split("_c")[0];
    if (baseTs <= lastBaseTs) {
      this.collisionCounter++;
      ts = `${baseTs}_c${this.collisionCounter.toString().padStart(4, "0")}`;
    } else {
      this.collisionCounter = 0;
      ts = baseTs;
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
