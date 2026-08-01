import { WebContentsView, type BaseWindow } from "electron";
import type {
  Engine,
  EnginePageState,
  EngineTab,
  NetworkSummary,
  PageIR,
  ScreenshotResult,
  ScrollOptions,
  WaitForOptions,
} from "@proa/protocol";
import { buildPageIR, type DomLikeElement } from "@proa/extractor";

/**
 * A serialized DOM snapshot node produced in the page context by a pure (agent-logic-free)
 * serializer, then adapted to the extractor's DomLike interface in the main process. The
 * agent's DECISION loop never runs in the page — only mechanical DOM reads/ops do.
 */
interface SnapNode {
  tag: string;
  attrs: Record<string, string>;
  text: string; // direct text only
  children: SnapNode[];
}

class DomLikeAdapter implements DomLikeElement {
  nodeType = 1;
  nodeName: string;
  tagName: string;
  private _children: DomLikeAdapter[];
  constructor(private readonly node: SnapNode) {
    this.tagName = node.tag.toUpperCase();
    this.nodeName = this.tagName;
    this._children = node.children.map((c) => new DomLikeAdapter(c));
  }
  get textContent(): string {
    const kids = this._children.map((c) => c.textContent).join(" ");
    return `${this.node.text} ${kids}`.trim();
  }
  getAttribute(name: string): string | null {
    return name in this.node.attrs ? this.node.attrs[name]! : null;
  }
  hasAttribute(name: string): boolean {
    return name in this.node.attrs;
  }
  get childNodes(): ArrayLike<{ nodeType: number; nodeName: string; textContent: string | null; nodeValue?: string | null }> {
    // A synthetic text node exposes the element's OWN text so extractor.directText() works;
    // element children follow (extractor.childElements only reads .children, i.e. elements).
    return [
      { nodeType: 3, nodeName: "#text", textContent: this.node.text, nodeValue: this.node.text },
      ...this._children,
    ];
  }
  get children(): ArrayLike<DomLikeAdapter> {
    return this._children;
  }
}

// A serializer injected into the page: returns a compact DOM tree with direct text and a
// stamped data-proa-ref on every element so actions can target stable refs. Pure DOM work.
const SERIALIZER = `(() => {
  let i = 0;
  const walk = (el) => {
    el.setAttribute('data-proa-ref', 'r' + (i++));
    let text = '';
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.nodeValue;
    return {
      tag: el.tagName.toLowerCase(),
      attrs: Object.fromEntries([...el.attributes].map(a => [a.name, a.value])),
      text: text.replace(/\\s+/g, ' ').trim(),
      children: [...el.children].map(walk),
    };
  };
  return JSON.stringify({ tree: walk(document.documentElement), url: location.href, title: document.title });
})()`;

let tabCounter = 0;

/**
 * ChromiumEngine — the desktop engine adapter. One WebContentsView per tab; CDP attached via
 * webContents.debugger for programmatic control from OUTSIDE the page; session partitions per
 * Space. Implements the same @proa/protocol Engine as the headless DomEngine (ADR-0001), so
 * the exact same runtime/extractor/permissions/traces power the GUI.
 */
export class ChromiumEngine implements Engine {
  readonly name = "chromium";
  private tabs = new Map<string, ChromiumTab>();

  constructor(
    private readonly window: BaseWindow,
    private readonly partition: string,
    private readonly onBoundsRequest: () => Electron.Rectangle,
  ) {}

  async openTab(url?: string): Promise<EngineTab> {
    const id = `ctab-${tabCounter++}`;
    const view = new WebContentsView({
      webPreferences: { partition: this.partition, sandbox: true, contextIsolation: true },
    });
    this.window.contentView.addChildView(view);
    view.setBounds(this.onBoundsRequest());
    const tab = new ChromiumTab(id, view);
    await tab.attach();
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

  view(id: string): WebContentsView | undefined {
    return this.tabs.get(id)?.view;
  }

  chromiumTab(id: string): ChromiumTab | undefined {
    return this.tabs.get(id);
  }

  setBounds(rect: Electron.Rectangle): void {
    for (const t of this.tabs.values()) t.view.setBounds(rect);
  }

  setActive(id: string | null): void {
    for (const [tid, t] of this.tabs) t.view.setVisible(tid === id);
  }

  hideAll(): void {
    for (const t of this.tabs.values()) t.view.setVisible(false);
  }

  async close(): Promise<void> {
    for (const t of this.tabs.values()) await t.close();
    this.tabs.clear();
  }
}

class ChromiumTab implements EngineTab {
  private net: NetworkSummary = { requests: 0, failed: 0, bytes: 0, domains: [] };
  private shots = 0;
  /** Maps an IR ref (e.g. "n12") -> the page's stamped data-proa-ref (e.g. "r40"). */
  private refMap = new Map<string, string>();
  constructor(
    readonly id: string,
    readonly view: WebContentsView,
  ) {}

  /** Translate an IR ref to the DOM stamp the serializer wrote; fall back to the ref itself. */
  private stamp(ref: string): string {
    return this.refMap.get(ref) ?? ref;
  }

  private get wc() {
    return this.view.webContents;
  }

  async attach(): Promise<void> {
    try {
      this.wc.debugger.attach("1.3");
      await this.wc.debugger.sendCommand("Network.enable");
      await this.wc.debugger.sendCommand("Page.enable");
      this.wc.debugger.on("message", (_e, method, params) => {
        if (method === "Network.requestWillBeSent") this.net.requests++;
        if (method === "Network.loadingFailed") this.net.failed++;
        if (method === "Network.responseReceived") {
          const url = (params as { response?: { url?: string } }).response?.url;
          if (url) {
            try {
              const host = new URL(url).host;
              if (host && !this.net.domains.includes(host)) this.net.domains.push(host);
            } catch {
              /* ignore */
            }
          }
        }
      });
    } catch {
      /* debugger may already be attached */
    }
  }

  private async evaluate<T>(expression: string): Promise<T> {
    const res = (await this.wc.debugger.sendCommand("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as { result?: { value?: T } };
    return res.result?.value as T;
  }

  async snapshot(): Promise<PageIR> {
    const raw = await this.evaluate<string>(SERIALIZER);
    const parsed = JSON.parse(raw) as { tree: SnapNode; url: string; title: string };
    const root = new DomLikeAdapter(parsed.tree);
    this.refMap = new Map();
    return buildPageIR(root as unknown as DomLikeElement, {
      url: parsed.url,
      title: parsed.title,
      // Associate each IR ref with the DOM element's data-proa-ref stamp so ref-targeted
      // actions (click/type/select/waitFor/rectOf) resolve to the right node.
      onNode: (ref, el) => {
        const s = el.getAttribute("data-proa-ref");
        if (s) this.refMap.set(ref, s);
      },
    });
  }

  async navigate(url: string): Promise<void> {
    await this.wc.loadURL(url.startsWith("http") || url.startsWith("file") ? url : `https://${url}`);
  }
  async goBack(): Promise<void> {
    if (this.wc.navigationHistory.canGoBack()) this.wc.navigationHistory.goBack();
  }
  async goForward(): Promise<void> {
    if (this.wc.navigationHistory.canGoForward()) this.wc.navigationHistory.goForward();
  }

  private async actOnRef(ref: string, op: string): Promise<void> {
    await this.evaluate(
      `(() => { const el = document.querySelector('[data-proa-ref=${JSON.stringify(this.stamp(ref))}]'); if (!el) return false; ${op}; return true; })()`,
    );
  }

  async click(ref: string): Promise<void> {
    await this.actOnRef(ref, "el.click()");
  }
  async type(ref: string, text: string, opts?: { submit?: boolean }): Promise<void> {
    const t = JSON.stringify(text);
    await this.actOnRef(
      ref,
      `el.focus(); el.value = ${t}; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}))${
        opts?.submit ? "; if (el.form) el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit()" : ""
      }`,
    );
  }
  async select(ref: string, value: string): Promise<void> {
    await this.actOnRef(ref, `el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true}))`);
  }
  async scroll(opts: ScrollOptions): Promise<void> {
    const amt = opts.amount ?? 600;
    const expr =
      opts.direction === "top"
        ? "window.scrollTo(0,0)"
        : opts.direction === "bottom"
          ? "window.scrollTo(0,document.body.scrollHeight)"
          : `window.scrollBy(0, ${opts.direction === "up" ? -amt : amt})`;
    await this.evaluate(`(() => { ${expr}; return true; })()`);
  }
  async waitFor(opts: WaitForOptions): Promise<boolean> {
    const timeout = opts.timeoutMs ?? 5000;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const ok = await this.evaluate<boolean>(
        `(() => { ${
          opts.text
            ? `return document.body.innerText.includes(${JSON.stringify(opts.text)})`
            : opts.ref
              ? `return !!document.querySelector('[data-proa-ref=${JSON.stringify(this.stamp(opts.ref))}]')`
              : "return true"
        }; })()`,
      );
      if (ok) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  }
  async screenshot(): Promise<ScreenshotResult> {
    const img = await this.wc.capturePage();
    return { ref: `${this.id}-shot-${this.shots++}`, bytes: img.toPNG() };
  }
  /** Normalized (0..1) center of a ref's bounding rect, for the ghost cursor. */
  async rectOf(ref: string): Promise<{ x: number; y: number } | null> {
    return this.evaluate<{ x: number; y: number } | null>(
      `(() => { const el = document.querySelector('[data-proa-ref=${JSON.stringify(this.stamp(ref))}]'); if (!el) return null;
        const r = el.getBoundingClientRect(); const w = innerWidth||1, h = innerHeight||1;
        return { x: (r.left + r.width/2)/w, y: (r.top + r.height/2)/h }; })()`,
    );
  }

  async getState(): Promise<EnginePageState> {
    return {
      url: this.wc.getURL(),
      title: this.wc.getTitle(),
      canGoBack: this.wc.navigationHistory.canGoBack(),
      canGoForward: this.wc.navigationHistory.canGoForward(),
    };
  }
  async networkSummary(): Promise<NetworkSummary> {
    return { ...this.net, domains: [...this.net.domains] };
  }
  async close(): Promise<void> {
    try {
      this.wc.debugger.detach();
    } catch {
      /* ignore */
    }
    (this.view as unknown as { webContents: { close?: () => void } }).webContents.close?.();
  }
}
