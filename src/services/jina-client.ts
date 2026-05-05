export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOptions {
  num_results?: number;
  site?: string;
  country?: string;
}

export interface ReadOptions {
  target_selector?: string;
  remove_selector?: string;
  max_tokens?: number;
  include_images?: boolean;
  links?: "referenced" | "discarded" | "inline";
}

export interface ReadResult {
  title: string;
  content: string;
}

export const DEFAULT_REMOVE_SELECTOR = [
  "nav",
  "footer",
  "aside",
  "[role=banner]",
  "[role=navigation]",
  ".ad",
  ".ads",
  ".advertisement",
  ".cookie-banner",
  '[class*="newsletter"]',
  '[class*="subscribe"]',
  '[class*="paywall"]',
  '[class*="related"]',
  '[class*="recommended"]',
  'section[aria-label*="reklama"]',
].join(", ");

export function readerErrorMessage(status: number, statusText: string): string {
  const base = `Jina Reader API error: ${status} ${statusText}`;
  switch (status) {
    case 422:
      return `${base} — page likely empty/blocked or invalid selector. Try: 1) different URL from search results, 2) remove target_selector if set, 3) shorter URL.`;
    case 403:
    case 401:
      return `${base} — blocked by site (antibot, login wall, or paywall). Try a different source URL or verify URL is publicly accessible.`;
    case 404:
      return `${base} — URL not found. Verify URL exists; try a search.`;
    case 429:
      return `${base} — rate limited. Wait a few seconds before retrying.`;
    case 500:
    case 502:
    case 503:
    case 504:
      return `${base} — Jina/upstream error. Retry once; if still failing, try a different URL.`;
    default:
      return base;
  }
}

export function searchErrorMessage(status: number, statusText: string): string {
  const base = `Jina Search API error: ${status} ${statusText}`;
  if (status === 429) return `${base} — rate limited. Wait a few seconds before retrying.`;
  if (status >= 500) return `${base} — Jina/upstream error. Retry once.`;
  return base;
}

export class JinaClient {
  private apiKey: string;
  private readonly timeoutMs: number;

  constructor(apiKey: string, timeoutMs: number = 30_000) {
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new Error(
          `Request timeout after ${this.timeoutMs}ms — page took too long to load. Try a different URL.`
        );
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Return-Format": "markdown",
    };

    if (options.site) {
      headers["X-Site"] = options.site;
    }
    const body: Record<string, unknown> = { q: query };
    if (options.num_results) {
      body.num = options.num_results;
    }
    if (options.country) {
      body.gl = options.country.toLowerCase();
    }

    const response = await this.fetchWithTimeout("https://s.jina.ai/", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(searchErrorMessage(response.status, response.statusText));
    }

    const json = await response.json();
    if (!json.data || !Array.isArray(json.data)) {
      throw new Error(`Unexpected Jina Search API response: missing or invalid 'data' array`);
    }
    return json.data.map((item: { title: string; url: string; description: string }) => ({
      title: item.title,
      url: item.url,
      snippet: item.description,
    }));
  }

  async read(url: string, options: ReadOptions = {}): Promise<ReadResult> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Return-Format": "markdown",
    };

    headers["X-Retain-Images"] = options.include_images ? "all" : "none";

    const linksMode = options.links ?? "referenced";
    if (linksMode === "referenced") {
      headers["X-Md-Link-Style"] = "referenced";
    } else if (linksMode === "discarded") {
      headers["X-Md-Link-Style"] = "discarded";
    }

    if (options.target_selector) {
      headers["X-Target-Selector"] = options.target_selector;
    }
    if (options.remove_selector === undefined) {
      headers["X-Remove-Selector"] = DEFAULT_REMOVE_SELECTOR;
    } else if (options.remove_selector !== "") {
      headers["X-Remove-Selector"] = options.remove_selector;
    }
    // "" → header omitted (escape hatch)
    if (options.max_tokens) {
      headers["X-Token-Budget"] = String(options.max_tokens);
    }

    const response = await this.fetchWithTimeout("https://r.jina.ai/", {
      method: "POST",
      headers,
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      throw new Error(readerErrorMessage(response.status, response.statusText));
    }

    const json = await response.json();
    if (!json.data || typeof json.data.title !== "string" || typeof json.data.content !== "string") {
      throw new Error(`Unexpected Jina Reader API response: missing 'data.title' or 'data.content'`);
    }
    return { title: json.data.title, content: json.data.content };
  }
}
