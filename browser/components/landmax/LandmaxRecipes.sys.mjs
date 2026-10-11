/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Recipes (landmax-library: docs/site-apps-plan.md › Apps have three layers). Everything Reader learns about a
// site lives in that site's recipe, made on the first visit and used on every visit after:
//   clean.companies  JEV's verdict per outside company {purpose, needed, sameOwner, owner, at}
//   clean.switches   the person's switch per company (true = allow), "*" = let everything load
//   layout.hosts     per host: its CSS layout widths {widths: [{px, rules}], measuredAt} and the person's fit
//                    ("portrait" or "landscape")
//   css, js          the site's own fixes, injected on every visit (later; the old TPA recipes)
// One file per site (its base domain): ~/.local/share/landmax/recipes/<site>.json, shared by every profile.

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
});

const ROOT = PathUtils.join(Services.dirsvc.get("Home", Ci.nsIFile).path, ".local", "share", "landmax");
const DIR = PathUtils.join(ROOT, "recipes");

function blank(site) {
  return {
    version: 1,
    site,
    created: new Date().toISOString().slice(0, 10),
    clean: { companies: {}, switches: {} },
    layout: { hosts: {} },
    css: "",
    js: "",
  };
}

function fileFor(site) {
  // A site is a base domain ("dailymail.com"); keep the name safe as a file name anyway.
  return PathUtils.join(DIR, site.replace(/[^a-z0-9.-]/gi, "_") + ".json");
}

class Recipes {
  constructor() {
    this.cache = new Map();
    this.timers = new Map();
  }

  async init() {
    await IOUtils.makeDirectory(DIR, { ignoreExisting: true });
    const names = await IOUtils.getChildren(DIR).catch(() => []);
    for (const path of names.filter(p => p.endsWith(".json"))) {
      try {
        const r = await IOUtils.readJSON(path);
        if (r?.site) {
          this.cache.set(r.site, r);
        }
      } catch (e) {}
    }
    await this.migrate();
  }

  // Clean's first files (2026-10-10, judged.json and switches.json) move into the recipes.
  async migrate() {
    const old = PathUtils.join(ROOT, "clean");
    for (const [name, field] of [["judged.json", "companies"], ["switches.json", "switches"]]) {
      const path = PathUtils.join(old, name);
      if (!(await IOUtils.exists(path))) {
        continue;
      }
      try {
        const data = await IOUtils.readJSON(path);
        for (const [site, rows] of Object.entries(data)) {
          this.update(site, r => Object.assign(r.clean[field], { ...rows, ...r.clean[field] }));
        }
        await IOUtils.remove(path);
      } catch (e) {
        console.error("Landmax Recipes: couldn't move", path, e);
      }
    }
  }

  // Synchronous on purpose: Clean decides inside the network observer.
  get(site) {
    let r = this.cache.get(site);
    if (!r) {
      r = blank(site);
      this.cache.set(site, r);
    }
    return r;
  }

  has(site) {
    return this.cache.has(site);
  }

  update(site, change) {
    const r = this.get(site);
    change(r);
    lazy.clearTimeout(this.timers.get(site));
    this.timers.set(site, lazy.setTimeout(() => IOUtils.writeJSON(fileFor(site), r), 500));
    return r;
  }
}

let recipes = null;
let ready = null;
export const LandmaxRecipes = {
  ready() {
    if (!ready) {
      recipes = new Recipes();
      ready = recipes.init().then(() => recipes);
    }
    return ready;
  },
  get instance() {
    return recipes;
  },
};
