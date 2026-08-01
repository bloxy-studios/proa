import type { AgentStep, PageIR, RunOutcome } from "@proa/protocol";
import type { LedgerEntry as LedgerEntryLike } from "@proa/permissions";

/** A Space: an isolated container with its own cookie jar (session partition) and gradient. */
export interface SpaceInfo {
  id: string;
  name: string;
  gradient: string;
  partition: string;
}

export interface TabInfo {
  id: string;
  title: string;
  url: string;
  spaceId: string;
  loading: boolean;
  /** true when this tab is owned/driven by an agent (rendered visually distinct). */
  agentOwned: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface HistoryEntry {
  url: string;
  title: string;
  visitedAt: string;
}

export interface AgentUpdate {
  kind: "thought" | "step" | "outcome" | "ghost" | "permission";
  step?: AgentStep;
  thought?: string;
  outcome?: RunOutcome;
  /** Ghost-cursor target in page-relative coordinates (0..1). */
  ghost?: { x: number; y: number; label: string };
  permission?: PermissionPrompt;
}

export interface PermissionPrompt {
  id: string;
  agent: string;
  domain: string;
  space: string;
  capability: string;
  irreversible?: string;
  target?: string;
  reason: string;
}

/** The typed surface exposed to the renderer via contextBridge (see preload). */
export interface ProaBridge {
  listSpaces(): Promise<SpaceInfo[]>;
  createSpace(name: string): Promise<SpaceInfo>;
  switchSpace(id: string): Promise<void>;
  listTabs(spaceId: string): Promise<TabInfo[]>;
  openTab(spaceId: string, url?: string): Promise<TabInfo>;
  closeTab(tabId: string): Promise<void>;
  activateTab(tabId: string): Promise<void>;
  navigate(tabId: string, url: string): Promise<void>;
  goBack(tabId: string): Promise<void>;
  goForward(tabId: string): Promise<void>;
  history(query: string): Promise<HistoryEntry[]>;
  pageIR(tabId: string): Promise<PageIR>;
  copyPageAsJSON(tabId: string): Promise<string>;
  copyAsPlaywright(tabId: string): Promise<string>;
  networkSummary(tabId: string): Promise<{ requests: number; failed: number; bytes: number; domains: string[] }>;
  cdpEndpoint(tabId: string): Promise<string>;
  ledger(domain?: string, space?: string): Promise<LedgerEntryLike[]>;
  runAgent(input: { task: string; spaceId: string; startUrl?: string; maxSteps?: number }): Promise<{ runId: string }>;
  stopAgent(runId: string): Promise<void>;
  respondPermission(promptId: string, allow: boolean): Promise<void>;
  onAgentUpdate(cb: (runId: string, update: AgentUpdate) => void): () => void;
  onTabsChanged(cb: () => void): () => void;
  mcpBridgeInfo(): Promise<{ url: string | null; token: string | null }>;
}
