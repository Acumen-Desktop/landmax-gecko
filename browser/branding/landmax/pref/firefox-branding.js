/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// This file contains branding-specific prefs.

pref("startup.homepage_override_url", "");
pref("startup.homepage_welcome_url", "");
pref("startup.homepage_welcome_url.additional", "");
// The time interval between checks for a new version (in seconds)
pref("app.update.interval", 86400); // 24 hours
// Give the user x seconds to react before showing the big UI. default=24 hours
pref("app.update.promptWaitTime", 86400);
// URL user can browse to manually if for some reason all update installation
// attempts fail.
pref("app.update.url.manual", "");
// A default value for the "More information about this update" link
// supplied in the "An update is available" page of the update wizard.
pref("app.update.url.details", "");

// The number of days a binary is permitted to be old
// without checking for an update.  This assumes that
// app.update.checkInstallTime is true.
pref("app.update.checkInstallTime.days", 2);

// Give the user x seconds to reboot before showing a badge on the hamburger
// button. default=immediately
pref("app.update.badgeWaitTime", 0);

// Number of usages of the web console.
// If this is less than 5, then pasting code into the web console is disabled
pref("devtools.selfxss.count", 5);

// --- Landmax Reader (rebrand plan, step 2) ------------------------------------
// Read after firefox.js, so these override it. Updates come through Library's package server (pacman), so Firefox's
// own update pages are empty above. No welcome pages, no "what's new" after an update, no default-browser nag.
// The full "Out" list (telemetry, studies, promotions, sponsored) is rebrand plan step 5.
pref("browser.startup.homepage_override.mstone", "ignore");
pref("browser.aboutwelcome.enabled", false);
pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);
pref("datareporting.policy.firstRunURL", "");
pref("browser.shell.checkDefaultBrowser", false);
// Our version, shown in About as "Reader 0.2 (Gecko 159.0a1, date)" (rebrand plan, step 0 question 7).
pref("landmax.reader.version", "0.2");

// --- The "Out" list, first pass (rebrand plan, step 5) ---------------------------------------------------------
// From a 10-minute watch of a fresh Reader (2026-10-05). Defaults, not locked: a person can turn a service back on.
// Studies and remote experiments (Normandy, Nimbus), and the "which country are you in" lookup Normandy makes.
pref("app.normandy.enabled", false);
pref("app.normandy.api_url", "");
pref("app.shield.optoutstudies.enabled", false);
pref("messaging-system.rsexperimentloader.enabled", false);
// Merino (Mozilla's suggestion server): it got the town for New Tab's weather. Weather and sponsored suggestions off.
pref("browser.urlbar.merino.endpointURL", "");
pref("browser.urlbar.quicksuggest.enabled", false);
pref("browser.urlbar.suggest.weather", false);
pref("browser.urlbar.suggest.quicksuggest.sponsored", false);
pref("browser.urlbar.suggest.quicksuggest.nonsponsored", false);
pref("browser.newtabpage.activity-stream.showWeather", false);
pref("browser.newtabpage.activity-stream.system.showWeather", false);
// New Tab's stories and sponsored tiles (New Tab becomes the Library page later).
pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);
pref("browser.newtabpage.activity-stream.showSponsored", false);
pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);
pref("browser.newtabpage.activity-stream.feeds.telemetry", false);
pref("browser.newtabpage.activity-stream.telemetry", false);
// The region lookup (location.services.mozilla.com): Library knows where it is.
pref("browser.region.network.url", "");
pref("browser.region.update.enabled", false);
// Mozilla's silent updates to built-in add-ons; they come with Reader's own updates instead.
pref("extensions.systemAddon.update.enabled", false);
pref("extensions.systemAddon.update.url", "");
// Asking the add-on store about the built-in themes at every start.
pref("extensions.getAddons.cache.enabled", false);
// Kept, on purpose ("Just works"): Remote Settings' security lists (revoked certificates, blocked add-ons), translation
// models, password rules and site fixes; the Wi-Fi sign-in check; web push; Widevine and OpenH264 (James: keep DRM).

// Containers (separate logins per site): Search's Private mode, and later TPAs and raw vs clean (Firefox review: Just works).
pref("privacy.userContext.enabled", true);
