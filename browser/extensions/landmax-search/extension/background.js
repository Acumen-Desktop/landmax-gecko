"use strict";
// Landmax Search: runs searches for the panel (search.html). Rules (docs/search-plan.md):
// - one search per click, never in the background, never in a batch;
// - Google first, read from the page it sends to a hidden tab (Google needs a real browser since 2025);
// - "Also ask DuckDuckGo" only when clicked;
// - if Google asks "are you a robot?", the person answers it themselves: we show Google's own page.

const PANEL = browser.runtime.getURL("search.html");

// The launcher opens https://search.landmax.invalid/ (an address that can never resolve); it becomes the panel.
// Its ?q= is kept: "landmax-search <words>" opens the panel with that search (one search, asked for by the person).
browser.webRequest.onBeforeRequest.addListener(
  d => ({ redirectUrl: PANEL + new URL(d.url).search }),
  { urls: ["https://search.landmax.invalid/*"], types: ["main_frame"] },
  ["blocking"]
);
// At start the window may load that address before this add-on is running: turn such a tab into the panel too.
browser.tabs.query({}).then(tabs => {
  for (const t of tabs) {
    if (/^https:\/\/search\.landmax\.invalid\//.test(t.url || "")) {
      browser.tabs.update(t.id, { url: PANEL + new URL(t.url).search });
    }
  }
});

// One hidden tab per cookie store does the Google searches: "firefox-default" (signed in) or the Private container.
const workers = new Map();

async function panelWindow() {
  const [tab] = await browser.tabs.query({ url: PANEL });
  return tab ? tab.windowId : undefined;
}

async function workerTab(store) {
  const id = workers.get(store);
  if (id != null) {
    try {
      await browser.tabs.get(id);
      return id;
    } catch {
      workers.delete(store);
    }
  }
  const tab = await browser.tabs.create({
    url: "about:blank",
    active: false,
    cookieStoreId: store,
    windowId: await panelWindow(),
  });
  await browser.tabs.hide(tab.id).catch(() => {});
  workers.set(store, tab.id);
  return tab.id;
}

// Resolves when the tab has finished loading a real page (not the about:blank it starts on).
function loaded(tabId, ms = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      browser.tabs.onUpdated.removeListener(on);
      reject(new Error("Google took too long to answer."));
    }, ms);
    function on(id, info, tab) {
      if (id !== tabId || info.status !== "complete" || tab.url === "about:blank") {
        return;
      }
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(on);
      resolve(tab);
    }
    browser.tabs.onUpdated.addListener(on, { tabId, properties: ["status"] });
  });
}

// What Google receives: the words plus the "never show" sites as -site: (shown to the person in grey).
function googleQuery(words, opts) {
  const never = (opts.never || []).map(s => "-site:" + s);
  return [words.trim(), ...never].join(" ");
}

function googleUrl(words, opts) {
  const u = new URL("https://www.google.com/search");
  u.searchParams.set("q", googleQuery(words, opts));
  if (opts.view === "web") {
    u.searchParams.set("udm", "14"); // just the links: no AI summary, no boxes, no ads
  }
  const tbs = [];
  if (opts.when) {
    tbs.push("qdr:" + opts.when); // h, d, w, m, y
  }
  if (opts.exact) {
    tbs.push("li:1"); // exactly as typed: Google doesn't "fix" the words
  }
  if (tbs.length) {
    u.searchParams.set("tbs", tbs.join(","));
  }
  return u.href;
}

async function google(words, opts) {
  const store = opts.private ? await privateStore() : "firefox-default";
  const tabId = await workerTab(store);
  const url = googleUrl(words, opts);
  const done = loaded(tabId);
  await browser.tabs.update(tabId, { url });
  const tab = await done;
  if (new URL(tab.url).pathname.startsWith("/sorry")) {
    return { check: true, tabId, sent: googleQuery(words, opts) };
  }
  const [page] = await browser.tabs.executeScript(tabId, { file: "google-read.js" });
  return { ...page, sent: googleQuery(words, opts) };
}

// DuckDuckGo's plain HTML page needs no scripts, so it's fetched directly; nothing is remembered (no cookies).
async function duck(words) {
  const r = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(words), {
    credentials: "omit",
  });
  const doc = new DOMParser().parseFromString(await r.text(), "text/html");
  const results = [];
  for (const el of doc.querySelectorAll(".result")) {
    if (el.classList.contains("result--ad")) {
      continue;
    }
    const a = el.querySelector("a.result__a");
    let href = a?.getAttribute("href") || "";
    const m = href.match(/[?&]uddg=([^&]+)/);
    if (m) {
      href = decodeURIComponent(m[1]);
    }
    if (!a || !/^https?:/.test(href)) {
      continue;
    }
    results.push({
      title: a.textContent.trim(),
      url: href,
      site: new URL(href).hostname.replace(/^www\./, ""),
      snippet: el.querySelector(".result__snippet")?.textContent.trim() || "",
    });
  }
  return { results: results.slice(0, 10) };
}

// Private: a throwaway container, signed out; it's removed (cookies and all) when Private is switched off.
let privateId = null;

async function privateStore() {
  if (!privateId) {
    const c = await browser.contextualIdentities.create({
      name: "Private search",
      color: "purple",
      icon: "fingerprint",
    });
    privateId = c.cookieStoreId;
  }
  return privateId;
}

async function endPrivate() {
  if (!privateId) {
    return;
  }
  const id = workers.get(privateId);
  workers.delete(privateId);
  if (id != null) {
    await browser.tabs.remove(id).catch(() => {});
  }
  await browser.contextualIdentities.remove(privateId).catch(() => {});
  privateId = null;
}

// A result opens in Reader (the Centre zone), in the running project's own profile, through Library's app opener.
function open(url) {
  return browser.runtime.sendNativeMessage("global.landmax.search", { open: url });
}

// Google asked "are you a robot?": show its own page in the panel's window so the person can answer it.
async function showCheck(tabId) {
  await browser.tabs.show(tabId).catch(() => {});
  await browser.tabs.update(tabId, { active: true });
  // When the check is passed Google goes on to the results: back to the panel, which searches again.
  function on(id, info, tab) {
    if (id !== tabId || info.status !== "complete" || new URL(tab.url).pathname.startsWith("/sorry")) {
      return;
    }
    browser.tabs.onUpdated.removeListener(on);
    backToPanel(tabId).then(() => browser.runtime.sendMessage({ type: "checkDone" }).catch(() => {}));
  }
  browser.tabs.onUpdated.addListener(on, { tabId, properties: ["status"] });
}

async function backToPanel(tabId) {
  const [panel] = await browser.tabs.query({ url: PANEL });
  if (panel) {
    await browser.tabs.update(panel.id, { active: true });
  }
  await browser.tabs.hide(tabId).catch(() => {});
}

browser.runtime.onMessage.addListener(msg => {
  const answer = handle(msg);
  // Every failure is written to the log as well as shown in the panel.
  answer?.catch?.(e => console.error("Landmax Search:", msg.type, e));
  return answer;
});

function handle(msg) {
  switch (msg.type) {
    case "google":
      return google(msg.words, msg.opts || {});
    case "duck":
      return duck(msg.words);
    case "open":
      return open(msg.url);
    case "endPrivate":
      return endPrivate();
    case "showCheck":
      return showCheck(msg.tabId);
    case "backToPanel":
      return backToPanel(msg.tabId);
  }
  return undefined;
}
