import type { PageIR } from "./ir.js";

/**
 * EngineAdapter — the boundary that keeps `@proa/core` ignorant of Electron.
 * Two adapters ship in v0.1: ChromiumEngine (Electron + CDP, in apps/browser) and
 * DomEngine (jsdom, headless, in @proa/core). See ADR-0001.
 */

export interface EnginePageState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface NetworkSummary {
  requests: number;
  failed: number;
  bytes: number;
  domains: string[];
}

export interface ScreenshotResult {
  ref: string;
  /** Raw PNG bytes when the engine can produce them (Chromium). */
  bytes?: Uint8Array;
  /** Set by DomEngine, which cannot render pixels. */
  placeholder?: boolean;
}

export interface ScrollOptions {
  direction: "up" | "down" | "top" | "bottom";
  amount?: number;
}

export interface WaitForOptions {
  ref?: string;
  text?: string;
  timeoutMs?: number;
}

export interface EngineTab {
  readonly id: string;
  /** Distill the current page to Page IR (accessibility-first). */
  snapshot(): Promise<PageIR>;
  navigate(url: string): Promise<void>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  click(ref: string): Promise<void>;
  type(ref: string, text: string, opts?: { submit?: boolean }): Promise<void>;
  select(ref: string, value: string): Promise<void>;
  scroll(opts: ScrollOptions): Promise<void>;
  waitFor(opts: WaitForOptions): Promise<boolean>;
  screenshot(opts?: { fullPage?: boolean }): Promise<ScreenshotResult>;
  getState(): Promise<EnginePageState>;
  networkSummary(): Promise<NetworkSummary>;
  close(): Promise<void>;
}

export interface Engine {
  readonly name: string;
  openTab(url?: string): Promise<EngineTab>;
  listTabs(): Promise<EngineTab[]>;
  getTab(id: string): Promise<EngineTab | undefined>;
  close(): Promise<void>;
}
