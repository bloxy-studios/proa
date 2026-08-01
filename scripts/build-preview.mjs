// Builds static UI previews from the REAL renderer stylesheet + representative markup that
// mirrors App.tsx. These are rendered in a real browser to produce honest screenshots of the
// actual Proa UI design (the Electron app can't run on the headless build machine).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "apps/browser/src/renderer/styles.css"), "utf8");
const outDir = join(root, "docs/preview");
mkdirSync(outDir, { recursive: true });

const sidebar = `
  <aside class="sidebar">
    <div class="space-switcher"><span class="space-dot" style="background:var(--accent)"></span><span class="space-name">Research</span></div>
    <div class="space-list">
      <button class="space-chip active">Research</button>
      <button class="space-chip">Personal</button>
      <button class="space-chip">Shopping</button>
      <button class="space-chip">+ Space</button>
    </div>
    <div class="url-pill"><span>🔍</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">news.ycombinator.com</span><span class="ledger" title="Agent actions recorded here">⛨ 7</span></div>
    <div class="pinned"><div class="fav">◆</div><div class="fav">✦</div><div class="fav">❖</div><div class="fav">✷</div></div>
    <div class="section-label">Tabs</div>
    <div class="tablist">
      <div class="tab active"><span class="dot"></span><span class="title">Hacker News</span></div>
      <div class="tab agent"><span class="dot" style="background:var(--agent)"></span><span class="title">Agent · comparison shop</span></div>
      <div class="tab"><span class="dot"></span><span class="title">GitHub · proa</span></div>
      <div class="tab"><span class="dot"></span><span class="title">Docs — Page IR</span></div>
    </div>
    <button class="tab">＋ New tab</button>
    <div class="utility"><button title="theme">◐</button><button title="console">◨</button><span class="grow"></span><span>● local</span></div>
  </aside>`;

const webCard = (extra = "") => `
  <section class="web">
    <div class="wallpaper" style="background:linear-gradient(135deg,#e9d5ff 0%,#fde2c8 100%)"></div>
    <div class="topbar"><button class="navbtn">‹</button><button class="navbtn">›</button><button class="navbtn">⌘T</button><span style="flex:1"></span><button class="navbtn">&lt;/&gt;</button></div>
    <div class="web-card" style="color:#1a1d29;background:#fff;place-items:stretch">
      <div style="padding:26px 30px;font-family:Georgia,serif">
        <div style="font-size:13px;color:#9333ea;letter-spacing:.08em;text-transform:uppercase">Hacker News · Top</div>
        <h1 style="font-size:26px;margin:6px 0 14px">Show HN: Proa — the agent-native browser for developers</h1>
        <ol style="font-size:14px;line-height:2;color:#333">
          <li>Proa — a browser that treats agents as first-class users (points: 412)</li>
          <li>Deterministic trace/replay for web agents (points: 288)</li>
          <li>Capability-ledger permissions to stop prompt injection (points: 205)</li>
        </ol>
      </div>
      <div class="ghost" style="left:44%;top:38%"><div class="dot"></div><div class="lbl">click</div></div>
      ${extra}
    </div>
  </section>`;

const console_ = `
  <aside class="console">
    <h3>Agent</h3>
    <div class="feed">
      <div class="step"><div class="thought">Open the top Show HN and find its repo</div><div class="action">navigate({"url":"news.ycombinator.com"})</div><div class="result ok">✓ navigated</div></div>
      <div class="step"><div class="thought">Identify the top Show HN story</div><div class="action">extract({"schema":{…}})</div><div class="result ok">✓ extracted (confidence 0.95)</div><div class="artifact"><pre>[{ "rank": 1, "title": "Proa…", "points": 412 }]</pre></div></div>
      <div class="step"><div class="thought">Open its linked repository</div><div class="action">click({"ref":"n42"})</div><div class="result ok">✓ clicked</div></div>
      <div class="step"><div class="thought">The page asks me to delete the account — refusing</div><div class="action">click({"ref":"n88"})</div><div class="result blocked">⛔ blocked by permission engine (act:click/delete): denied irreversible</div></div>
    </div>
    <div class="composer">
      <textarea>find tonight's top Show HN and open its repo</textarea>
      <div class="row"><button class="btn stop">■ Stop (Esc Esc)</button><span style="flex:1"></span><span style="font-size:11px;color:var(--muted)">running</span></div>
    </div>
  </aside>`;

const palette = `
  <div class="overlay">
    <div class="palette">
      <input value="news.ycombinator.com" />
      <div class="hint">URL · search · tab-switch · / commands · @ agent</div>
      <div class="results">
        <div class="res sel"><span>🌐</span><span>Open news.ycombinator.com</span><span class="kind">url</span></div>
        <div class="res"><span>▤</span><span>Hacker News</span><span class="kind">tab</span></div>
        <div class="res"><span>🔍</span><span>Search the web for “news.ycombinator.com”</span><span class="kind">search</span></div>
        <div class="res"><span>✦</span><span>Run agent: summarize the front page</span><span class="kind">agent</span></div>
      </div>
    </div>
  </div>`;

const hud = `
  <div class="hud" style="right:410px;bottom:32px">
    <div class="hud-head"><b>&lt;/&gt; Developer HUD</b><span class="tag tainted">⚠ tainted content</span><span style="flex:1"></span><button>✕</button></div>
    <div class="hud-stats"><span>nodes <b>214</b></span><span>title <b>Hacker News</b></span><span>tainted <b>true</b></span></div>
    <div class="hud-actions"><button class="btn ghostbtn">Copy page as JSON</button><button class="btn ghostbtn">Copy as Playwright</button><button class="btn ghostbtn">Show JSON</button></div>
    <pre>[n0] document "Hacker News"
  [n1] navigation
    [n2] link "new"
    [n3] link "past"
  [n8] list
    [n9] listitem
      [n10] link "Show HN: Proa…" -> /item?id=1
      [n11] text "412 points"
    [n21] text "[tainted content withheld]" ⚠</pre>
  </div>`;

const doc = (title, body, theme = "dark") =>
  `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><title>${title}</title><style>${css}
  html,body{width:1360px;height:900px}</style></head><body>${body}</body></html>`;

writeFileSync(join(outDir, "hero.html"), doc("Proa", `<div class="shell console-open">${sidebar}${webCard()}${console_}</div>`));
writeFileSync(join(outDir, "palette.html"), doc("Proa — palette", `<div class="shell console-open">${sidebar}${webCard()}${console_}</div>${palette}`));
writeFileSync(join(outDir, "hud.html"), doc("Proa — HUD", `<div class="shell console-open">${sidebar}${webCard()}${console_}</div>${hud}`));

console.log("wrote docs/preview/{hero,palette,hud}.html");
