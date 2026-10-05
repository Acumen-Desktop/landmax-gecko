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
  // Web view: the same answer with the summary hidden in the panel (Google's udm=14 page is a layout we can't read).
  if (opts.view === "news") {
    u.searchParams.set("tbm", "nws");
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
  if (opts.debug) {
    // Tests only: a sample of Google's page, to see a layout the reader doesn't know yet.
    [page.sample] = await browser.tabs.executeScript(tabId, {
      code: `[...document.querySelectorAll("a[href^='/url'], a[href^='/goto'], a[href^='http']")].slice(0, 30).map(a => { let e = a; for (let i = 0; i < 3 && e.parentElement; i++) e = e.parentElement; return e.outerHTML.replace(/<(style|script|svg)[\\s\\S]*?<\\/\\1>/g, "").slice(0, 700); }).join("\\n----\\n")`,
    });
  }
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

// Looking inside a result: the page is fetched once as plain text (no scripts run, no cookies sent) and read for
// what sites label for Google and Facebook (picture, kind, author, date, paywall), its length (read time) and its
// junk (scripts, ad and tracker companies, size). Never Google: only the result's own page.
const TRACKERS =
  /(doubleclick|googlesyndication|googletagmanager|google-analytics|googleadservices|adservice\.google|facebook\.net|connect\.facebook|amazon-adsystem|taboola|outbrain|criteo|scorecardresearch|quantserve|quantcast|adnxs|rubiconproject|pubmatic|moatads|hotjar|chartbeat|parsely|permutive|tiktok|ads-twitter|bat\.bing|clarity\.ms|segment\.(com|io)|optimizely|branch\.io|onetrust|cookielaw|teads|sharethrough|openx|indexww|casalemedia|33across|yieldmo|gumgum|media\.net|revcontent|mgid|smartadserver|adsafeprotected|doubleverify|krxd|bluekai|demdex|omtrdc|adsrvr|liadm|id5-sync|lotame|crwdcntrl|tapad|rlcdn|agkn|piano\.io|tinypass|newrelic|nr-data|sentry-cdn|cxense|blueconic|mparticle|amplitude|mixpanel|heap(analytics)?|fullstory|pinimg|licdn|snap\.licdn|reddit\.com\/static\/pixel)/i;

// The kinds a page can say it is (schema.org and Open Graph), in plain words.
const KINDS = {
  NewsArticle: "News", ReportageNewsArticle: "News", AnalysisNewsArticle: "News", LiveBlogPosting: "News",
  OpinionNewsArticle: "Opinion", BlogPosting: "Blog", Article: "Article", TechArticle: "Article",
  ScholarlyArticle: "Research", Product: "Shop", ProductGroup: "Shop", Offer: "Shop", VideoObject: "Video",
  Recipe: "Recipe", DiscussionForumPosting: "Forum", QAPage: "Forum", Event: "Event", JobPosting: "Job",
};

// What the address alone says, before (or without) looking inside.
function kindOfHost(host) {
  if (/(^|\.)(gov|gc\.ca|canada\.ca|gov\.[a-z]{2}|gouv\.[a-z.]+|europa\.eu)$/.test(host)) return "Government";
  if (/wikipedia\.org$|britannica\.com$/.test(host)) return "Encyclopedia";
  if (/(reddit|quora|stackexchange|stackoverflow)\.com$/.test(host)) return "Forum";
  if (/(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com)$/.test(host)) return "Video";
  if (/(amazon|ebay|walmart|etsy|bestbuy|homedepot|costco)\.[a-z.]+$/.test(host)) return "Shop";
  if (/(^|\.)edu$|(^|\.)ac\.[a-z]{2}$|arxiv\.org$|nih\.gov$/.test(host)) return "Research";
  return "";
}

const site2 = host => host.split(".").slice(-2).join(".");

function ldObjects(doc) {
  const out = [];
  const add = o => {
    if (Array.isArray(o)) {
      o.forEach(add);
    } else if (o && typeof o === "object") {
      out.push(o);
      if (o["@graph"]) add(o["@graph"]);
    }
  };
  for (const el of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      add(JSON.parse(el.textContent));
    } catch {}
  }
  return out;
}

async function enrich(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { credentials: "omit", signal: ctl.signal, headers: { Accept: "text/html,*/*;q=0.5" } });
    const type = r.headers.get("content-type") || "";
    const host = new URL(r.url).hostname.replace(/^www\./, "");
    if (!/html/.test(type)) {
      return { kind: /pdf/.test(type) ? "PDF" : kindOfHost(host), kb: Math.round((+r.headers.get("content-length") || 0) / 1024) || null };
    }
    const html = (await r.text()).slice(0, 4000000);
    const doc = new DOMParser().parseFromString(html, "text/html");
    // A tiny page with no title is a site turning the look away (Forbes does), not the page.
    if (html.length < 3000 && !doc.title) {
      return { failed: "the site turned the look away", kind: kindOfHost(host) };
    }
    const meta = n => doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`)?.getAttribute("content") || "";
    const ld = ldObjects(doc);
    const typed = ld.find(o => [].concat(o["@type"] || []).some(t => KINDS[t]));
    const ogType = meta("og:type");

    let kind = typed ? KINDS[[].concat(typed["@type"]).find(t => KINDS[t])] : "";
    kind ||= kindOfHost(host);
    kind ||= /^video/.test(ogType) ? "Video" : ogType === "product" ? "Shop" : ogType === "article" ? "Article" : "";

    const abs = u => {
      try {
        return u ? new URL(u, r.url).href : "";
      } catch {
        return "";
      }
    };
    const ldImage = [].concat(typed?.image || [])[0];
    const picture = abs(meta("og:image") || meta("twitter:image") || (typeof ldImage === "string" ? ldImage : ldImage?.url));
    const published = typed?.datePublished || meta("article:published_time") || doc.querySelector("time[datetime]")?.getAttribute("datetime") || "";
    const authors = [].concat(typed?.author || []).map(a => (typeof a === "string" ? a : a?.name)).filter(Boolean);
    const author = authors.slice(0, 2).join(", ") || meta("author");
    const free = ld.find(o => "isAccessibleForFree" in o)?.isAccessibleForFree;
    const paywall = free === false || /^false$/i.test(String(free)) || /locked|metered|subscriber/i.test(meta("article:content_tier"));

    // Junk: every script, the companies they come from, and frames.
    const own = site2(host);
    const hosts = new Set();
    const trackers = new Set();
    let scripts = 0;
    for (const el of doc.querySelectorAll("script, iframe")) {
      if (el.tagName === "SCRIPT" && /json/.test(el.type)) continue;
      scripts++;
      const src = el.getAttribute("src");
      if (!src) continue;
      let h;
      try {
        h = new URL(src, r.url).hostname;
      } catch {
        continue;
      }
      if (site2(h) !== own) hosts.add(site2(h));
      if (TRACKERS.test(h + new URL(src, r.url).pathname)) trackers.add(site2(h));
    }
    // Inline scripts name tracker companies too (tag managers load the rest later).
    for (const m of html.matchAll(/(googletagmanager|google-analytics|doubleclick|facebook\.net|amazon-adsystem|taboola|outbrain|criteo|hotjar|chartbeat|permutive|piano\.io|adnxs|scorecardresearch)/gi)) {
      trackers.add(m[1].toLowerCase());
    }
    const kb = Math.round(html.length / 1024);
    const score = Math.min(100, Math.round(Math.min(kb / 25, 25) + Math.min(trackers.size * 6, 45) + Math.min(hosts.size * 2, 20) + Math.min(scripts / 8, 10)));

    // Read time: the article's words (or the main part's), at 230 a minute.
    for (const el of doc.querySelectorAll("script, style, noscript, nav, header, footer, aside, form")) el.remove();
    const body = doc.querySelector("[itemprop='articleBody'], article, main, [role='main']") || doc.body;
    const words = (body?.textContent.match(/[\p{L}\p{N}']+/gu) || []).length;

    return {
      picture, kind, published, author, paywall,
      readMin: words >= 120 ? Math.max(1, Math.round(words / 230)) : 0,
      junk: { score, kb, scripts, hosts: hosts.size, trackers: [...trackers].slice(0, 12) },
    };
  } catch (e) {
    return { failed: String(e.name === "AbortError" ? "too slow" : e.message || e) };
  } finally {
    clearTimeout(timer);
  }
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
    case "enrich":
      return enrich(msg.url);
    case "classify":
      // JEV, through Library's helper (it holds the key): the kind of page, for rows whose pages don't say.
      return browser.runtime.sendNativeMessage("global.landmax.search", { classify: msg.rows });
    case "kindOfHost":
      return Promise.resolve(kindOfHost(msg.host));
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
