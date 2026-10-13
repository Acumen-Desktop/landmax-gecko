/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Puts a site's recipe on its pages (landmax-library: docs/site-apps-plan.md, step 5): every tweak that's on, and the
// person's own css and js (LandmaxRecipes). Style sheets go in as author sheets as the window is made, before the page
// draws, so the page's own security rules can't refuse them; scripts run when the page has loaded, each in its own
// sandbox over the page (like an add-on's content script), never as the page's own script.

const INJECT_KEY = "LandmaxRecipes:inject";

function sheetURI(css) {
  return "data:text/css;charset=utf-8," + encodeURIComponent(css);
}

export class LandmaxRecipeChild extends JSWindowActorChild {
  constructor() {
    super();
    this.sheets = new Map(); // tweak id -> the sheet's URI on this page
    this.reported = {}; // tweak id -> what its script last reported
    this.items = [];
  }

  // The site's injections for this page's host: "mail.google.com" looks under mail.google.com, google.com and com.
  itemsFor(all) {
    const host = this.document?.location?.hostname;
    if (!host || !all) {
      return [];
    }
    const labels = host.split(".");
    const out = [];
    for (let i = 0; i < labels.length; i++) {
      for (const item of all[labels.slice(i).join(".")] ?? []) {
        if (!item.hosts || item.hosts.includes(host)) {
          out.push(item);
        }
      }
    }
    return out;
  }

  async handleEvent(event) {
    if (event.type === "DOMWindowCreated") {
      const all = Services.cpmm.sharedData.get(INJECT_KEY);
      if (all) {
        this.items = this.itemsFor(all);
        this.applySheets();
      } else {
        // Reader is still starting: ask (the first page may draw once without its sheet).
        this.asking = this.sendQuery("LandmaxRecipe:Get").catch(() => null).then(answer => {
          this.items = this.itemsFor(answer);
          this.applySheets();
        });
      }
    } else if (event.type === "DOMContentLoaded") {
      await this.asking;
      for (const item of this.items.filter(i => i.js)) {
        this.run(item);
      }
    }
  }

  applySheets() {
    const utils = this.contentWindow?.windowUtils;
    if (!utils) {
      return;
    }
    const wanted = new Map(this.items.filter(i => i.css).map(i => [i.id, sheetURI(i.css)]));
    for (const [id, uri] of this.sheets) {
      if (wanted.get(id) !== uri) {
        utils.removeSheetUsingURIString(uri, utils.AUTHOR_SHEET);
        this.sheets.delete(id);
      }
    }
    for (const [id, uri] of wanted) {
      if (!this.sheets.has(id)) {
        utils.loadSheetUsingURIString(uri, utils.AUTHOR_SHEET);
        this.sheets.set(id, uri);
      }
    }
  }

  run(item) {
    const win = this.contentWindow;
    const sandbox = Cu.Sandbox([this.document.nodePrincipal], {
      sandboxPrototype: win,
      sameZoneAs: win,
      wantXrays: true,
      sandboxName: `Landmax recipe ${this.document.location.hostname} ${item.id || "own"}`,
    });
    sandbox.report = Cu.exportFunction(n => {
      this.reported[item.id] = Number(n) || 0;
    }, sandbox);
    try {
      Cu.evalInSandbox(item.js, sandbox, "latest", `landmax-recipe:${this.document.location.hostname}/${item.id || "own"}`, 1);
    } catch (e) {
      console.error("Landmax recipe", item.id, e);
    }
  }

  receiveMessage(message) {
    switch (message.name) {
      case "LandmaxRecipe:Apply":
        // A switch changed: style sheets change at once; scripts need the page to load again.
        this.items = this.itemsFor(message.data);
        this.applySheets();
        return null;
      case "LandmaxRecipe:Count": {
        // What each tweak finds on this page: matches of its hidden selectors, or what its script reported.
        const counts = { ...this.reported };
        for (const item of this.items.filter(i => i.hide.length)) {
          try {
            counts[item.id] = (counts[item.id] ?? 0) + this.document.querySelectorAll(item.hide.join(",")).length;
          } catch (e) {}
        }
        return counts;
      }
    }
    return null;
  }
}
