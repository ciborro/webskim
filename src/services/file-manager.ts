import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export class FileManager {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  generateFilename(url: string): string {
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/\./g, "_");

    // Process pathname: strip leading slash, extension, and normalize
    let path = parsed.pathname
      .slice(1)  // remove leading /
      .replace(/\.[^.]+$/, "")  // strip file extension
      .replace(/\//g, "__");      // slashes to double underscores

    // Remove trailing underscores
    path = path.replace(/_+$/, "");

    const now = new Date();
    const ts = now.toISOString()
      .replace(/[-:T]/g, "")
      .slice(0, 15)
      .replace(/^(\d{8})(\d{6}).*/, "$1_$2");

    const slug = path ? `${domain}__${path}` : domain;
    return `${ts}_${slug}.md`;
  }

  async savePage(content: string, url: string): Promise<string> {
    await mkdir(this.baseDir, { recursive: true });
    const filename = this.generateFilename(url);
    const filePath = join(this.baseDir, filename);
    await writeFile(filePath, content, "utf-8");
    return filePath;
  }
}
