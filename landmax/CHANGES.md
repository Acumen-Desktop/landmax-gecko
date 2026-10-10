# Our changes to Mozilla's files

Every change we make outside `landmax/` and `browser/branding/landmax/`, so a merge from Mozilla is easy to redo
(rebrand plan, steps 3 and 6). Rule: **"Firefox" the product name goes; "Mozilla" stays where it names Mozilla
itself** (its add-on rules, its account and services, its certificate list). Mozilla's services keep their names
(Firefox Relay, Mozilla Monitor, Mozilla VPN): they are the person's choice. Keep `about:license` and the MPL notices.

## Step 3: leftover "Firefox" (2026-10-05)

| File | Change | Why |
| --- | --- | --- |
| `browser/base/content/aboutDialog.xhtml` | Adds `#landmaxDesc` (text in our `brand.ftl`) | Our own line in About |
| `browser/base/content/aboutDialog.js` | Version reads "Reader 0.2 (Gecko 159.0a1, date)" when `landmax.reader.version` is set | Step 0, question 7 |
| `browser/locales/en-US/chrome/overrides/appstrings.properties`, `dom/locales/en-US/chrome/appstrings.properties` | "Firefox can't…" → "Reader can't…" | Error pages |
| `toolkit/locales/en-US/toolkit/neterror/certError.ftl`, `security/manager/locales/en-US/chrome/pipnss/pipnss.properties` | "is backed by the non-profit Mozilla" → "uses the certificate list of the non-profit Mozilla" | True for us |
| `toolkit/locales/en-US/toolkit/about/aboutAddons.ftl` | "Firefox recommends" → "Mozilla recommends" (2 strings) | Mozilla picks them |
| `browser/locales/en-US/browser/appExtensionFields.ftl` | "Firefox Alpenglow" → "Alpenglow" | |
| `toolkit/locales/en-US/toolkit/branding/brandings.ftl` | Screenshots, Translations, Suggestions, Home, "All your tabs" (Firefox View), Labs | Firefox's feature names |
| `browser/locales/en-US/browser/browser.ftl`, `menubar.ftl`, `toolkit/.../aboutReader.ftl` | "Enter Reader View" → "Show just the text"; "Close Reader View" → "Back to the full page" | "Reader View" in a browser called Reader is confusing |
| `toolkit/themes/shared/illustrations/{no-connection,security-error,kit-*}.svg` | Fox drawings → plain Landmax tiles | Error pages, Settings, PDF, restart |
| `browser/themes/shared/privatebrowsing/{kit-pbw,fox-tail}.svg`, `toolkit/themes/shared/extensions/kit-{addons,themes}.svg`, `browser/themes/shared/preferences/fox-ai.svg`, `browser/themes/shared/icons/window-firefox.svg` | Same | Private window, Add-ons, Settings |

Branding (ours, not Mozilla's files): `-vendor-short-name` stays "Mozilla"; Mozilla's community, donate, feedback,
help, terms and privacy links in About are hidden by `browser/branding/landmax/content/aboutDialog.css`.

**Left for later steps:** the default bookmarks (Mozilla's; step 4, `NoDefaultBookmarks` policy); onboarding,
telemetry pages, "More from Mozilla" (the Out list, step 5); the sidebar and Firefox View foxes (Landmax does tabs,
hidden later); the Mozilla account's fox avatar (Mozilla's own service); DevTools texts (for developers, and true).

## The Search panel (2026-10-05)

| File | Change | Why |
| --- | --- | --- |
| `browser/extensions/moz.build` | Adds `landmax-search` to `DIRS` | Builds our Search add-on in (ours: `browser/extensions/landmax-search/`) |

## Site apps (2026-10-07, `site-apps-plan.md` in landmax-library)

| File | Change | Why |
| --- | --- | --- |
| `browser/components/shell/ShellService.sys.mjs` | `_findStartupCommand` returns `$LANDMAX_READER_LAUNCHER` when set | The `.desktop` files written for site apps must run our launcher (it sets the identity file), not the bare engine |

The switch itself is a branding pref (`browser.taskbarTabs.enabled`), not a change to Mozilla's files.

## Logins (2026-10-08, `site-apps-plan.md` › Accounts in landmax-library)

| File | Change | Why |
| --- | --- | --- |
| `browser/components/moz.build` | Adds `landmax` to `DIRS` | Our own front-end parts: `browser/components/landmax/` |
| `browser/components/DesktopActorRegistry.sys.mjs` | Registers the `LandmaxLogins` actor on `accounts.google.com` and `workspace.google.com` | A login's sign-in page gets its email filled (never submitted); a signed-out Gmail app that lands on Google's advert page goes to sign-in instead |

The identity file also gets `UAName=Firefox` (`make-application-ini.sh`): without it websites saw `landmax-reader/159.0a1`,
and Google served its basic, light-only sign-in page.

## The app bar (2026-10-10, `site-apps-plan.md` step 3 in landmax-library)

| File | Change | Why |
| --- | --- | --- |
| `browser/components/taskbartabs/TaskbarTabsChrome.sys.mjs` | `init` also calls `LandmaxAppBar.init(window)` | An app's own bar: icon, name, account with a live check, Clean's count, settings (`browser/components/landmax/LandmaxAppBar.sys.mjs`, `appbar.css`) |
