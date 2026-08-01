import type { ProaBridge } from "../shared/types.js";

declare global {
  interface Window {
    proa: ProaBridge;
    proaChrome: {
      setOverlay(open: boolean): Promise<void>;
      setConsole(open: boolean): Promise<void>;
    };
  }
}

export {};
