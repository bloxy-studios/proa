import { JSDOM } from "jsdom";
import type {
  Engine,
  EngineTab,
  EnginePageState,
  NetworkSummary,
  PageIR,
  ScreenshotResult,
  ScrollOptions,
  WaitForOptions,
} from "@proa/protocol";
import { buildPageIR, type DomLikeElement } from "@proa/extractor";

/** Resolve a URL (with query) to HTML. Fixtures provide this; the web path uses fetch. */
export type Resolver = (url: string) => string | Promise<string>;

export interface DomEngineOptions {
  /** Deterministic route resolver (fixtures/benchmark). Takes precedence over fetch. */
  resolve?: Resolver;
  /** Fetch HTML for a real URL. Defaults to global fetch. */
  fetchHtml?: Resolver;
  /** Base URL used to resolve relative links/actions. */
  baseUrl?: string;
  now?: () => string;
}

async function defaultFetchHtml(url: string): Promise<string> {
  const res = await fetch(url);
  return await res.text();
}

/**
 * A deterministic, headless engine backed by jsdom. It shares the exact runtime, IR,
 * permission model, and tool surface as the Chromium engine — it just cannot render
 * pixels. This is what makes the SDK, CLI (`--headless`), and the whole CI benchmark run
 * in pure Node with no display (ADR-0001, ADR-0006).
 */
export class DomEngine implements Engine {
  readonly name = "dom";
  private tabs = new Map<string, DomTab>();
  private counter = 0;
  private resolver: Resolver;

  constructor(private readonly opts: DomEngineOptions = {}) {
    this.resolver = opts.resolve ?? opts.fetchHtml ?? defaultFetchHtml;
  }

  async openTab(url?: string): Promise<EngineTab> {
    const id = `tab-${this.counter++}`;
    const tab = new DomTab(id, this.resolver, this.opts);
    this.tabs.set(id, tab);
    if (url) await tab.navigate(url);
    return tab;
  }

  async listTabs(): Promise<EngineTab[]> {
    return [...this.tabs.values()];
  }

  async getTab(id: string): Promise<EngineTab | undefined> {
    return this.tabs.get(id);
  }

  async close(): Promise<void> {
    this.tabs.clear();
  }
}

class DomTab implements EngineTab {
  private dom?: JSDOM;
  private url = "about:blank";
  private history: string[] = [];
  private historyIndex = -1;
  private refMap = new Map<string, DomLikeElement>();
  private net: NetworkSummary = { requests: 0, failed: 0, bytes: 0, domains: [] };
  private shots = 0;

  constructor(
    readonly id: string,
    private readonly resolver: Resolver,
    private readonly opts: DomEngineOptions,
  ) {}

  private resolveUrl(href: string): string {
    try {
      return new URL(href, this.url === "about:blank" ? this.opts.baseUrl : this.url).toString();
    } catch {
      return href;
    }
  }

  private async load(url: string, pushHistory: boolean): Promise<void> {
    const html = await Promise.resolve(this.resolver(url));
    this.net.requests++;
    this.net.bytes += html.length;
    try {
      const host = new URL(url).host;
      if (host && !this.net.domains.includes(host)) this.net.domains.push(host);
    } catch {
      /* relative/local */
    }
    this.dom = new JSDOM(html, { url: /^https?:/.test(url) ? url : undefined });
    this.url = url;
    if (pushHistory) {
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push(url);
      this.historyIndex = this.history.length - 1;
    }
  }

  async navigate(url: string): Promise<void> {
    await this.load(this.resolveUrl(url), true);
  }

  async goBack(): Promise<void> {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      await this.load(this.history[this.historyIndex]!, false);
    }
  }

  async goForward(): Promise<void> {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      await this.load(this.history[this.historyIndex]!, false);
    }
  }

  async snapshot(): Promise<PageIR> {
    if (!this.dom) {
      return {
        url: this.url,
        title: "",
        capturedAt: (this.opts.now ?? (() => new Date().toISOString()))(),
        root: { ref: "n0", role: "document" },
        nodeCount: 1,
        tainted: false,
      };
    }
    const doc = this.dom.window.document;
    this.refMap = new Map();
    const ir = buildPageIR(doc.documentElement as unknown as DomLikeElement, {
      url: this.url,
      title: doc.title,
      now: this.opts.now,
      onNode: (ref, el) => this.refMap.set(ref, el),
    });
    return ir;
  }

  private el(ref: string): Element {
    // Snapshot lazily if needed so refs are populated.
    const found = this.refMap.get(ref);
    if (!found) throw new Error(`unknown ref ${ref} (snapshot first)`);
    return found as unknown as Element;
  }

  async click(ref: string): Promise<void> {
    const el = this.el(ref);
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (tag === "a" && el.getAttribute("href")) {
      await this.navigate(el.getAttribute("href")!);
      return;
    }
    if (tag === "button" && type === "submit") {
      await this.submitForm(el);
      return;
    }
    if (tag === "input" && (type === "submit" || type === "button")) {
      await this.submitForm(el);
      return;
    }
    if (tag === "button" || el.getAttribute("role") === "button") {
      const form = el.closest("form");
      if (form) {
        await this.submitForm(el);
        return;
      }
    }
    // Static content: dispatch a DOM click for any handlers, otherwise a no-op.
    (el as unknown as HTMLElement).click?.();
  }

  private async submitForm(fromEl: Element): Promise<void> {
    const form = fromEl.closest("form");
    if (!form) return;
    const action = form.getAttribute("action") || this.url;
    const method = (form.getAttribute("method") || "get").toLowerCase();
    const params = new URLSearchParams();
    form.querySelectorAll("input, select, textarea").forEach((f) => {
      const name = f.getAttribute("name");
      if (!name) return;
      const t = (f.getAttribute("type") ?? "").toLowerCase();
      if ((t === "checkbox" || t === "radio") && !(f as HTMLInputElement).checked) return;
      const val = (f as HTMLInputElement).value ?? f.getAttribute("value") ?? "";
      params.append(name, val);
    });
    // Include the submit button's name/value if present.
    const bname = fromEl.getAttribute("name");
    if (bname) params.append(bname, fromEl.getAttribute("value") ?? "");
    const base = this.resolveUrl(action);
    const target = method === "get" ? `${base.split("?")[0]}?${params.toString()}` : base;
    await this.navigate(target);
  }

  async type(ref: string, text: string, opts?: { submit?: boolean }): Promise<void> {
    const el = this.el(ref) as HTMLInputElement;
    el.value = text;
    el.setAttribute("value", text);
    if (opts?.submit) await this.submitForm(el);
  }

  async select(ref: string, value: string): Promise<void> {
    const el = this.el(ref) as HTMLSelectElement;
    el.value = value;
    el.setAttribute("value", value);
  }

  async scroll(_opts: ScrollOptions): Promise<void> {
    /* no layout in jsdom — scrolling is a no-op that still succeeds */
  }

  async waitFor(opts: WaitForOptions): Promise<boolean> {
    if (!this.dom) return false;
    if (opts.text) return (this.dom.window.document.body.textContent ?? "").includes(opts.text);
    if (opts.ref) return this.refMap.has(opts.ref);
    return true;
  }

  async screenshot(): Promise<ScreenshotResult> {
    return { ref: `${this.id}-shot-${this.shots++}`, placeholder: true };
  }

  async getState(): Promise<EnginePageState> {
    return {
      url: this.url,
      title: this.dom?.window.document.title ?? "",
      canGoBack: this.historyIndex > 0,
      canGoForward: this.historyIndex < this.history.length - 1,
    };
  }

  async networkSummary(): Promise<NetworkSummary> {
    return { ...this.net, domains: [...this.net.domains] };
  }

  async close(): Promise<void> {
    this.dom?.window.close();
    this.dom = undefined;
  }
}
