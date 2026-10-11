/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Clean, second stage (landmax-library: docs/site-apps-plan.md › Apps have three layers). uBlock Origin's block
// list runs first; whatever outside company a page still asks for is then blocked unless something says it's needed:
//   1. the person's switch for that company on that site, or "let everything load" for the site;
//   2. the site's own company (owners.json: who owns which domain, from DuckDuckGo's Tracker Radar and Disconnect,
//      made by landmax/tools/make-owners.py; FAMILIES fills gaps) and the infrastructure every site may need
//      (sign-in, payments, security checks);
//   3. JEV's judgement (asked through the landmax-reader-clean helper, one call per site): what the
//      company is there for; content, fonts, video players, maps, sign-in, payments and security are allowed;
//      ads, tracking, social and popups are blocked even when the site's own organisation runs them; comments and
//      anything else are blocked unless the site's own organisation runs them.
// A company nobody has judged yet is blocked and asked about; if JEV then allows it, the page reloads once.
// Verdicts and switches live in the site's recipe (LandmaxRecipes), made on the first visit.

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  LandmaxRecipes: "moz-src:///browser/components/landmax/LandmaxRecipes.sys.mjs",
  Subprocess: "resource://gre/modules/Subprocess.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
});

// A vendor's own addresses count as the site itself, not as outside companies.
// Gaps in owners.json for the vendors Library's apps use most.
export const FAMILIES = [
  { name: "Google", domains: ["google.com", "google.ca", "gstatic.com", "googleusercontent.com", "googleapis.com",
    "ggpht.com", "youtube.com", "ytimg.com", "youtube-nocookie.com", "gmail.com", "googlevideo.com", "recaptcha.net"] },
  { name: "Microsoft", domains: ["microsoft.com", "live.com", "office.com", "office.net", "microsoftonline.com",
    "sharepoint.com", "outlook.com", "msauth.net", "msftauth.net", "bing.com", "onedrive.com", "skype.com"] },
  { name: "Apple", domains: ["apple.com", "icloud.com", "mzstatic.com", "cdn-apple.com"] },
  { name: "Anthropic", domains: ["anthropic.com", "claude.ai", "claude.com"] },
  { name: "X", domains: ["x.com", "twitter.com", "twimg.com", "x.ai", "grok.com"] },
];
// Every site may need these to sign in, pay or pass a security check.
const INFRASTRUCTURE = new Set([
  "accounts.google.com", "google.com", "gstatic.com", "recaptcha.net", "hcaptcha.com", "cloudflare.com",
  "challenges.cloudflare.com", "stripe.com", "stripe.network", "paypal.com", "paypalobjects.com",
  "microsoftonline.com", "live.com", "apple.com", "appleid.apple.com",
]);
const ALLOWED_PURPOSES = new Set(["Content", "Fonts", "Video player", "Maps", "Sign-in", "Payments", "Security"]);
// Junk stays blocked even when the site's own organisation runs it (its own consent popup, its own tracker).
const JUNK_PURPOSES = new Set(["Ads", "Tracking", "Social", "Popups"]);
const KINDS = {
  [Ci.nsIContentPolicy.TYPE_SCRIPT]: "script",
  [Ci.nsIContentPolicy.TYPE_IMAGE]: "image",
  [Ci.nsIContentPolicy.TYPE_IMAGESET]: "image",
  [Ci.nsIContentPolicy.TYPE_STYLESHEET]: "stylesheet",
  [Ci.nsIContentPolicy.TYPE_SUBDOCUMENT]: "frame",
  [Ci.nsIContentPolicy.TYPE_FONT]: "font",
  [Ci.nsIContentPolicy.TYPE_MEDIA]: "media",
  [Ci.nsIContentPolicy.TYPE_XMLHTTPREQUEST]: "xhr",
  [Ci.nsIContentPolicy.TYPE_FETCH]: "xhr",
  [Ci.nsIContentPolicy.TYPE_BEACON]: "beacon",
  [Ci.nsIContentPolicy.TYPE_PING]: "beacon",
  [Ci.nsIContentPolicy.TYPE_WEBSOCKET]: "websocket",
};

function baseDomain(host) {
  try {
    return Services.eTLD.getBaseDomainFromHost(host);
  } catch (e) {
    return host;
  }
}

// Who owns which domain: {companies: [names], domains: {domain: index}} (owners.json), loaded once per Reader.
let owners = null;
const ownersReady = fetch("chrome://browser/content/landmax/owners.json")
  .then(r => r.json())
  .then(o => (owners = o))
  .catch(e => console.error("Landmax Clean: no owners list", e));

export function ownerOf(domain) {
  // The domain itself, then its parents (fonts.googleapis.com -> googleapis.com: some are suffixes of their own).
  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const d = labels.slice(i).join(".");
    const known = owners?.domains[d];
    if (known !== undefined) {
      return owners.companies[known];
    }
    const family = FAMILIES.find(f => f.domains.includes(d));
    if (family) {
      return family.name;
    }
  }
  return null;
}

export function isOutside(site, company) {
  if (company === site) {
    return false;
  }
  const owner = ownerOf(site);
  return !(owner && owner === ownerOf(company));
}


class Clean {
  constructor() {
    this.pages = new Map(); // a tab's browserId (stable across site changes) -> {site, companies, reloaded}
    this.queue = new Map(); // site -> Map(company -> evidence)
    this.timers = new Map();
    this.asking = new Set();
    this.listeners = new Set();
  }

  async init() {
    await ownersReady;
    this.recipes = await lazy.LandmaxRecipes.ready();
    Services.obs.addObserver(this, "http-on-modify-request");
  }

  verdict(site, company) {
    return this.recipes.has(site) ? this.recipes.get(site).clean.companies[company] : undefined;
  }

  // --- The decision ----------------------------------------------------------------------------------------

  decide(site, company) {
    const mine = this.recipes.has(site) ? this.recipes.get(site).clean.switches : {};
    if (company in mine) {
      return { allow: mine[company], why: "switch" };
    }
    if (mine["*"]) {
      return { allow: true, why: "everything" };
    }
    if (INFRASTRUCTURE.has(company)) {
      return { allow: true, why: "infrastructure" };
    }
    const j = this.verdict(site, company);
    if (!j) {
      return { allow: false, why: "unknown" };
    }
    const allow = ALLOWED_PURPOSES.has(j.purpose) || ((j.sameOwner ?? 0) >= 0.5 && !JUNK_PURPOSES.has(j.purpose));
    return { allow, why: "judged" };
  }

  // --- Watching every request ------------------------------------------------------------------------------

  observe(subject) {
    let channel;
    try {
      channel = subject.QueryInterface(Ci.nsIHttpChannel);
    } catch (e) {
      return;
    }
    const info = channel.loadInfo;
    const bc = info && BrowsingContext.get(info.browsingContextID);
    if (!bc || !bc.top.embedderElement) {
      return; // Reader's own requests (updates, lists) aren't a page's.
    }
    const top = bc.top;
    // Apps only for now: Browser gets the allow-list with its own Clean panel (site-apps-plan.md, step 6), so a
    // page broken by it always has a switch to fix it. uBlock Origin's block list runs everywhere.
    if (!top.topChromeWindow?.document.documentElement.hasAttribute("taskbartab")) {
      return;
    }
    const kind = info.externalContentPolicyType;
    if (kind === Ci.nsIContentPolicy.TYPE_DOCUMENT) {
      // A new page in this tab: a new report.
      const site = baseDomain(channel.URI.host);
      const before = this.pages.get(top.browserId);
      this.pages.set(top.browserId, { site, companies: new Map(), reloaded: before?.site === site && before.reloaded });
      this.notify(top.browserId);
      return;
    }
    const page = this.pages.get(top.browserId);
    if (!page || !page.site) {
      return;
    }
    let host;
    try {
      host = channel.URI.host;
    } catch (e) {
      return;
    }
    const company = baseDomain(host);
    if (!isOutside(page.site, company)) {
      return;
    }
    let row = page.companies.get(company);
    if (!row) {
      row = { company, hosts: new Set(), sends: {}, requests: 0, blocked: 0 };
      page.companies.set(company, row);
    }
    row.hosts.add(host);
    const what = KINDS[kind] || "other";
    row.sends[what] = (row.sends[what] || 0) + 1;
    row.requests++;
    const verdict = this.decide(page.site, company);
    row.why = verdict.why;
    row.allowed = verdict.allow;
    if (!verdict.allow) {
      row.blocked++;
      channel.cancel(Cr.NS_BINDING_ABORTED);
      if (verdict.why === "unknown") {
        this.ask(page.site, row);
      }
    }
    this.notify(top.browserId);
  }

  // --- Asking JEV ------------------------------------------------------------------------------------------

  ask(site, row) {
    let q = this.queue.get(site);
    if (!q) {
      q = new Map();
      this.queue.set(site, q);
    }
    q.set(row.company, row);
    // Wait until the page has asked for most of what it wants, then one call for the whole site.
    lazy.clearTimeout(this.timers.get(site));
    this.timers.set(site, lazy.setTimeout(() => this.flush(site), 1500));
  }

  helper() {
    const file = Services.dirsvc.get("GreD", Ci.nsIFile);
    file.append("landmax-reader-clean");
    return file.exists() ? file.path : null;
  }

  async flush(site) {
    const q = this.queue.get(site);
    this.queue.delete(site);
    const path = this.helper();
    if (!q || !path || this.asking.has(site)) {
      return;
    }
    this.asking.add(site);
    const companies = [...q.values()].filter(r => !this.verdict(site, r.company)).map(r => ({
      domain: r.company, owner: ownerOf(r.company), hosts: [...r.hosts].slice(0, 5), sends: r.sends,
    }));
    try {
      if (!companies.length) {
        return;
      }
      const proc = await lazy.Subprocess.call({ command: path, arguments: ["judge"], stderr: "stdout" });
      proc.stdin.write(JSON.stringify({ site, siteOwner: ownerOf(site), companies }));
      await proc.stdin.close();
      let out = "";
      let chunk;
      while ((chunk = await proc.stdout.readString())) {
        out += chunk;
      }
      await proc.wait();
      const answer = JSON.parse(out);
      if (!answer.ok) {
        return;
      }
      const at = new Date().toISOString().slice(0, 10);
      this.recipes.update(site, r => {
        for (const [company, j] of Object.entries(answer.companies)) {
          r.clean.companies[company] = { ...j, owner: ownerOf(company), at };
        }
      });
      this.reloadWhereNowAllowed(site);
    } catch (e) {
      console.error("Landmax Clean: couldn't ask JEV", e);
    } finally {
      this.asking.delete(site);
      for (const [id, page] of this.pages) {
        if (page.site === site) {
          this.notify(id);
        }
      }
    }
  }

  reloadWhereNowAllowed(site) {
    for (const [id, page] of this.pages) {
      if (page.site !== site || page.reloaded) {
        continue;
      }
      const missed = [...page.companies.values()].some(r => r.blocked && this.decide(site, r.company).allow);
      if (missed) {
        page.reloaded = true;
        this.browserFor(id)?.reload();
      }
    }
  }

  browserFor(browserId) {
    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      for (const browser of win.gBrowser?.browsers ?? []) {
        if (browser.browserId === browserId) {
          return browser;
        }
      }
    }
    return null;
  }

  // --- For the app bar and settings ------------------------------------------------------------------------

  report(browser) {
    const page = this.pages.get(browser.browserId);
    if (!page) {
      return { site: null, rows: [], blocked: 0, allowedOutside: 0 };
    }
    const rows = [...page.companies.values()].map(r => {
      const j = this.verdict(page.site, r.company);
      const verdict = this.decide(page.site, r.company);
      return { company: r.company, owner: ownerOf(r.company), requests: r.requests, blocked: r.blocked,
               allowed: verdict.allow, why: verdict.why,
               purpose: verdict.why === "infrastructure" ? "Sign-in, payments or security" : j?.purpose ?? null,
               checking: !j && verdict.why === "unknown" };
    });
    rows.sort((a, b) => b.allowed - a.allowed || b.requests - a.requests);
    return {
      site: page.site,
      everything: !!(this.recipes.has(page.site) && this.recipes.get(page.site).clean.switches["*"]),
      rows,
      blocked: rows.reduce((n, r) => n + r.blocked, 0),
      allowedOutside: rows.filter(r => r.allowed).length,
    };
  }

  setSwitch(site, company, allow) {
    this.recipes.update(site, r => {
      if (allow === null) {
        delete r.clean.switches[company];
      } else {
        r.clean.switches[company] = allow;
      }
    });
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(id) {
    for (const fn of this.listeners) {
      fn(id);
    }
  }
}

let clean = null;
export const LandmaxClean = {
  // Once per Reader, from the first window. Search is its own app and reads Google's pages as they are.
  init() {
    if (clean || Services.appinfo.name === "landmax-search") {
      return;
    }
    clean = new Clean();
    clean.init();
  },
  get instance() {
    return clean;
  },
};
