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
}

export interface ReadResult {
  title: string;
  content: string;
}

export interface SegmentResult {
  num_tokens: number;
  chunks: string[];
}

export class JinaClient {
  private apiKey: string;
  private readonly timeoutMs = 30000;

  private fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    return fetch(url, { ...init, signal: controller.signal }).finally(() =>
      clearTimeout(timeout)
    );
  }

  constructor(apiKey: string) {
    this.apiKey = apiKey;
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
    if (options.country) {
      headers["X-Locale"] = options.country;
    }

    const body: Record<string, unknown> = { q: query };
    if (options.num_results) {
      body.num = options.num_results;
    }

    const response = await this.fetchWithTimeout("https://s.jina.ai/", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Jina Search API error: ${response.status} ${response.statusText}`);
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

    if (options.target_selector) {
      headers["X-Target-Selector"] = options.target_selector;
    }
    if (options.remove_selector) {
      headers["X-Remove-Selector"] = options.remove_selector;
    }
    if (options.max_tokens) {
      headers["X-Token-Budget"] = String(options.max_tokens);
    }

    const response = await this.fetchWithTimeout("https://r.jina.ai/", {
      method: "POST",
      headers,
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      throw new Error(`Jina Reader API error: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    if (!json.data || typeof json.data.title !== "string" || typeof json.data.content !== "string") {
      throw new Error(`Unexpected Jina Reader API response: missing 'data.title' or 'data.content'`);
    }
    return { title: json.data.title, content: json.data.content };
  }

  async segment(content: string): Promise<SegmentResult> {
    const response = await this.fetchWithTimeout("https://segment.jina.ai/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content,
        tokenizer: "cl100k_base",
        return_tokens: false,
        return_chunks: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Jina Segmenter API error: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    if (typeof json.num_tokens !== "number" || !Array.isArray(json.chunks)) {
      throw new Error(`Unexpected Jina Segmenter API response: missing 'num_tokens' or 'chunks'`);
    }
    return { num_tokens: json.num_tokens, chunks: json.chunks };
  }
}
