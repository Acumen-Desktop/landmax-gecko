/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The app bar (landmax-library: docs/site-apps-plan.md › Browser, Apps and Accounts, step 3). An app is a web app
// window (Taskbar Tabs) listed in its account profile's landmax-logins.json. Its toolbar shows the app's own icon and
// name, the account it uses with a live check, back, forward, reload, where it is when off its own site, what Clean
// removed (LandmaxClean), and a settings panel: Account, Clean (a switch per outside company), Look.

const HTML = "http://www.w3.org/1999/xhtml";
const UBO = "uBlock0@raymondhill.net";
const CHECK = {
  google: "https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard",
};

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  LandmaxClean: "moz-src:///browser/components/landmax/LandmaxClean.sys.mjs",
  isOutside: "moz-src:///browser/components/landmax/LandmaxClean.sys.mjs",
  ExtensionParent: "resource://gre/modules/ExtensionParent.sys.mjs",
  NetUtil: "resource://gre/modules/NetUtil.sys.mjs",
  setInterval: "resource://gre/modules/Timer.sys.mjs",
  clearInterval: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

let registryPromise = null;
function registry() {
  registryPromise ||= (async () => {
    const file = PathUtils.join(PathUtils.profileDir, "landmax-logins.json");
    return (await IOUtils.exists(file)) ? IOUtils.readJSON(file) : null;
  })();
  return registryPromise;
}

function baseDomain(host) {
  try {
    return Services.eTLD.getBaseDomainFromHost(host);
  } catch (e) {
    return host;
  }
}

function iconURL(name) {
  // The app's own made icon, from the icon theme folders (the home copy installs into ~/.local/share/icons).
  const dirs = [
    PathUtils.join(Services.dirsvc.get("Home", Ci.nsIFile).path, ".local", "share", "icons", "hicolor"),
    "/usr/share/icons/hicolor",
  ];
  for (const dir of dirs) {
    for (const sub of [["scalable", "apps", name + ".svg"], ["256x256", "apps", name + ".png"], ["48x48", "apps", name + ".png"]]) {
      const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      file.initWithPath(PathUtils.join(dir, ...sub));
      if (file.exists()) {
        return Services.io.newFileURI(file).spec;
      }
    }
  }
  return "chrome://branding/content/icon32.png";
}

async function signedInAs(vendor) {
  const url = CHECK[vendor];
  if (!url) {
    return null;
  }
  const uri = Services.io.newURI(url);
  const channel = lazy.NetUtil.newChannel({
    uri,
    loadingPrincipal: Services.scriptSecurityManager.createContentPrincipal(uri, {}),
    securityFlags: Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL,
    contentPolicyType: Ci.nsIContentPolicy.TYPE_OTHER,
  });
  const text = await new Promise((resolve, reject) =>
    lazy.NetUtil.asyncFetch(channel, (stream, status) => {
      if (!Components.isSuccessCode(status)) {
        reject(new Error("status " + status));
        return;
      }
      resolve(lazy.NetUtil.readInputStreamToString(stream, stream.available(), { charset: "UTF-8" }));
    })
  );
  // Only email addresses are kept; the first is the account the vendor uses by default.
  return [...new Set(text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || [])].map(e => e.toLowerCase());
}

class AppBar {
  constructor(win, app, account) {
    this.win = win;
    this.doc = win.document;
    this.app = app;
    this.account = account;
    this.appHost = Services.io.newURI(app.url).host;
    this.state = "checking";
    this.emails = [];
  }

  el(tag, props = {}, ...kids) {
    const e = this.doc.createElementNS(HTML, tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") {
        e.className = v;
      } else if (k.startsWith("on")) {
        e.addEventListener(k.slice(2), v);
      } else {
        e.setAttribute(k, v);
      }
    }
    e.append(...kids);
    return e;
  }

  build() {
    const { doc } = this;
    doc.documentElement.setAttribute("landmax-app", "true");
    const style = doc.createProcessingInstruction(
      "xml-stylesheet",
      'href="chrome://browser/content/landmax/appbar.css" type="text/css"'
    );
    doc.insertBefore(style, doc.documentElement);

    this.icon = this.el("img", { class: "lm-icon", src: iconURL(this.app.icon), alt: "" });
    this.name = this.el("span", { class: "lm-name" }, this.app.name);
    this.chip = this.el("button", { class: "lm-account", onclick: () => this.openSettings("account") });
    const info = this.el("div", { class: "lm-info", id: "landmax-app-info" }, this.icon, this.name, this.chip);

    this.clean = this.el("button", { class: "lm-clean", onclick: () => this.openSettings("clean") });
    this.gear = this.el("button", { class: "lm-gear", title: "Settings for " + this.app.name,
                                    onclick: () => this.openSettings("account") });
    const tail = this.el("div", { class: "lm-tail", id: "landmax-app-tail" }, this.clean, this.gear);

    const target = doc.getElementById("nav-bar-customization-target");
    target.prepend(info);
    doc.getElementById("urlbar-container").after(tail);
    this.renderAccount();
    this.renderClean();
  }

  // --- Account ---------------------------------------------------------------------------------------------

  async check() {
    if (this.checking) {
      return;
    }
    this.checking = true;
    try {
      this.emails = (await signedInAs(this.account.vendor)) || [];
      const want = this.account.expect.toLowerCase();
      this.state = !this.emails.length ? "signed-out" : this.emails[0] === want ? "verified" : "wrong";
    } catch (e) {
      this.state = "unknown";
    } finally {
      this.checking = false;
      this.lastCheck = Date.now();
      this.renderAccount();
    }
  }

  renderAccount() {
    const words = {
      checking: this.account.expect,
      verified: "✓ " + this.account.expect,
      "signed-out": "Not signed in",
      wrong: "Wrong account: " + (this.emails[0] || "?"),
      unknown: this.account.expect + " (not checked)",
    };
    this.chip.textContent = words[this.state];
    this.chip.dataset.state = this.state;
    this.chip.title = {
      checking: "Checking which account this is…",
      verified: `Signed in as ${this.account.expect}, checked with ${this.account.vendor}`,
      "signed-out": `Sign in as ${this.account.expect}`,
      wrong: `This app is for ${this.account.expect}, but ${this.emails[0]} is signed in`,
      unknown: "Couldn't check which account is signed in",
    }[this.state];
    this.doc.documentElement.setAttribute("landmax-account", this.state);
    this.renderSettings?.();
  }

  // --- Clean -----------------------------------------------------------------------------------------------

  blocked() {
    // uBlock Origin's own count for this window's page (its badge number).
    try {
      const ext = lazy.ExtensionParent.GlobalManager.getExtension(UBO);
      const action = ext && lazy.ExtensionParent.apiManager.global.browserActionFor(ext)?.action;
      return parseInt(action?.getProperty(this.win.gBrowser.selectedTab, "badgeText"), 10) || 0;
    } catch (e) {
      return 0;
    }
  }

  report() {
    return lazy.LandmaxClean.instance?.report(this.win.gBrowser.selectedBrowser) ??
      { site: null, rows: [], blocked: 0, allowedOutside: 0 };
  }

  renderClean() {
    const r = this.report();
    const n = this.blocked() + r.blocked;
    this.clean.textContent = `${n} blocked · ${r.allowedOutside} outside`;
    this.clean.title = `${n} requests blocked on this page; ${r.allowedOutside} outside companies allowed`;
    if (this.section === "clean" && this.panel?.state === "open") {
      this.renderSettings();
    }
  }

  // --- Where the app is ------------------------------------------------------------------------------------

  onLocation(uri) {
    let host = "";
    try {
      host = uri.host;
    } catch (e) {}
    const away = host && lazy.isOutside(baseDomain(this.appHost), baseDomain(host));
    this.doc.documentElement.toggleAttribute("landmax-away", !!away);
    // Back on the app's own site after signing in: check the account again.
    if (host === this.appHost && Date.now() - (this.lastCheck || 0) > 5000) {
      this.check();
    }
  }

  // --- Settings --------------------------------------------------------------------------------------------

  openSettings(section) {
    if (!this.panel) {
      this.buildSettings();
    }
    this.section = section;
    this.renderSettings();
    this.panel.openPopup(this.gear, "bottomright topright", 0, 4);
  }

  buildSettings() {
    const { doc } = this;
    this.panel = doc.createXULElement("panel");
    this.panel.id = "landmax-app-settings";
    this.panel.setAttribute("type", "arrow");
    this.panel.setAttribute("role", "dialog");
    this.list = this.el("nav", { class: "lm-sections" });
    this.detail = this.el("section", { class: "lm-detail" });
    this.panel.append(this.el("div", { class: "lm-settings" }, this.list, this.detail));
    doc.getElementById("mainPopupSet").append(this.panel);
  }

  renderSettings() {
    if (!this.panel) {
      return;
    }
    const sections = { account: "Account", clean: "Clean", look: "Look" };
    this.list.replaceChildren(
      this.el("div", { class: "lm-title" }, this.icon.cloneNode(), this.app.name),
      ...Object.entries(sections).map(([key, label]) =>
        this.el("button", { class: key === this.section ? "lm-on" : "", onclick: () => {
          this.section = key;
          this.renderSettings();
        } }, label)
      )
    );
    this.detail.replaceChildren(...this["section_" + this.section]());
  }

  section_account() {
    const state = {
      checking: "Checking…",
      verified: "Signed in and checked",
      "signed-out": "Not signed in yet",
      wrong: "Wrong account signed in",
      unknown: "Couldn't check",
    }[this.state];
    return [
      this.el("h2", {}, this.account.name),
      this.el("p", { class: "lm-big", "data-state": this.state }, this.account.expect),
      this.el("p", {}, state + (this.state === "wrong" ? `: ${this.emails[0]}` : "")),
      this.el("p", { class: "lm-dim" },
        `${this.app.name} has its own sign-in, saved passwords and history, shared only with the other apps of ` +
        `${this.account.name}.`),
      this.el("div", { class: "lm-row" },
        this.el("button", { onclick: () => this.check() }, "Check again"),
        this.el("button", { onclick: () => this.goTo(this.app.url) },
          this.state === "verified" ? "Go to the start page" : "Sign in")),
    ];
  }

  section_clean() {
    const r = this.report();
    const n = this.blocked() + r.blocked;
    const reload = () => this.win.gBrowser.selectedBrowser.reload();
    const words = row => row.checking ? "Checking what it's for…" :
      row.why === "switch" ? `${row.purpose ?? "Your choice"} · your choice` :
      row.why === "everything" ? "Everything loads on this site" : row.purpose ?? "";
    const rows = r.rows.map(row => this.el("li", { "data-allowed": row.allowed },
      this.el("div", { class: "lm-company" },
        this.el("span", {}, row.company),
        this.el("span", { class: "lm-dim" }, words(row))),
      this.el("button", { class: "lm-switch", "aria-pressed": row.allowed,
        title: row.allowed ? `Block ${row.company} on ${r.site}` : `Allow ${row.company} on ${r.site}`,
        onclick: () => {
          lazy.LandmaxClean.instance.setSwitch(r.site, row.company, !row.allowed);
          reload();
        } }, row.allowed ? "Allowed" : "Blocked")));
    return [
      this.el("h2", {}, "Clean"),
      this.el("p", { class: "lm-big" }, `${n} blocked on this page`),
      this.el("p", { class: "lm-dim" },
        "Ads and trackers are blocked first. Every other outside company is blocked too, unless the page needs it: " +
        "JEV says what each one is for, and your switch always wins."),
      this.el("h3", {}, r.rows.length ? `Outside companies on ${r.site}` : "No outside companies on this page"),
      this.el("ul", { class: "lm-companies" }, ...rows),
      r.site && this.el("div", { class: "lm-row" },
        this.el("button", { onclick: () => {
          lazy.LandmaxClean.instance.setSwitch(r.site, "*", r.everything ? null : true);
          reload();
        } }, r.everything ? "Back to clean" : "Page broken? Let everything load")),
    ].filter(Boolean);
  }

  section_look() {
    const zoom = Math.round(this.win.ZoomManager.getZoomForBrowser(this.win.gBrowser.selectedBrowser) * 100);
    const act = fn => () => {
      fn();
      lazy.setTimeout(() => this.renderSettings(), 100);
    };
    return [
      this.el("h2", {}, "Look"),
      this.el("p", {}, "Size"),
      this.el("div", { class: "lm-row" },
        this.el("button", { onclick: act(() => this.win.FullZoom.reduce()) }, "Smaller"),
        this.el("span", { class: "lm-big" }, zoom + "%"),
        this.el("button", { onclick: act(() => this.win.FullZoom.enlarge()) }, "Bigger"),
        this.el("button", { onclick: act(() => this.win.FullZoom.reset()) }, "Normal")),
    ];
  }

  goTo(url) {
    this.panel?.hidePopup();
    this.win.gBrowser.selectedBrowser.fixupAndLoadURIString(url, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
  }

  start() {
    this.build();
    this.win.gBrowser.addProgressListener({
      onLocationChange: (progress, request, location) => {
        if (progress.isTopLevel) {
          this.onLocation(location);
        }
      },
      QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
    });
    const timer = lazy.setInterval(() => this.renderClean(), 2000);
    this.win.addEventListener("unload", () => {
      lazy.clearInterval(timer);
    }, { once: true });
    lazy.setTimeout(() => this.check(), 2000);
  }
}

export const LandmaxAppBar = {
  async init(win) {
    const id = win.document.documentElement.getAttribute("taskbartab");
    const reg = await registry();
    const app = reg?.apps?.find(a => a.taskbarTab === id);
    const account = reg?.logins?.[0];
    if (!app || !account) {
      return;
    }
    new AppBar(win, app, account).start();
  },
};
