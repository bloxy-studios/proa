import { contextBridge, ipcRenderer } from "electron";
import type { AgentUpdate, ProaBridge } from "../shared/types.js";

/** The typed bridge exposed to the renderer. Mirrors the same tool vocabulary as SDK/MCP. */
const bridge: ProaBridge = {
  listSpaces: () => ipcRenderer.invoke("spaces:list"),
  createSpace: (name) => ipcRenderer.invoke("spaces:create", name),
  switchSpace: (id) => ipcRenderer.invoke("spaces:switch", id),
  listTabs: (spaceId) => ipcRenderer.invoke("tabs:list", spaceId),
  openTab: (spaceId, url) => ipcRenderer.invoke("tabs:open", spaceId, url),
  closeTab: (tabId) => ipcRenderer.invoke("tabs:close", tabId),
  activateTab: (tabId) => ipcRenderer.invoke("tabs:activate", tabId),
  navigate: (tabId, url) => ipcRenderer.invoke("tabs:navigate", tabId, url),
  goBack: (tabId) => ipcRenderer.invoke("tabs:back", tabId),
  goForward: (tabId) => ipcRenderer.invoke("tabs:forward", tabId),
  history: (query) => ipcRenderer.invoke("history:search", query),
  pageIR: (tabId) => ipcRenderer.invoke("page:ir", tabId),
  copyPageAsJSON: (tabId) => ipcRenderer.invoke("page:json", tabId),
  copyAsPlaywright: (tabId) => ipcRenderer.invoke("page:playwright", tabId),
  networkSummary: (tabId) => ipcRenderer.invoke("page:network", tabId),
  cdpEndpoint: (tabId) => ipcRenderer.invoke("page:cdp", tabId),
  ledger: (domain, space) => ipcRenderer.invoke("ledger:read", domain, space),
  runAgent: (input) => ipcRenderer.invoke("agent:run", input),
  stopAgent: (runId) => ipcRenderer.invoke("agent:stop", runId),
  respondPermission: (promptId, allow) => ipcRenderer.invoke("permission:respond", promptId, allow),
  mcpBridgeInfo: () => ipcRenderer.invoke("mcp:info"),
  onAgentUpdate: (cb) => {
    const listener = (_e: unknown, runId: string, update: AgentUpdate) => cb(runId, update);
    ipcRenderer.on("agent:update", listener);
    return () => ipcRenderer.removeListener("agent:update", listener);
  },
  onTabsChanged: (cb) => {
    const listener = () => cb();
    ipcRenderer.on("tabs:changed", listener);
    return () => ipcRenderer.removeListener("tabs:changed", listener);
  },
};

// Extra renderer-only helpers not part of the cross-surface bridge.
const chrome = {
  setOverlay: (open: boolean) => ipcRenderer.invoke("overlay:set", open),
  setConsole: (open: boolean) => ipcRenderer.invoke("console:set", open),
};

contextBridge.exposeInMainWorld("proa", bridge);
contextBridge.exposeInMainWorld("proaChrome", chrome);

export type ProaChrome = typeof chrome;
