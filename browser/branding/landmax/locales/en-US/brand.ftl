# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## Firefox and Mozilla Brand
##
## Firefox and Mozilla must be treated as a brand.
##
## They cannot be:
## - Transliterated.
## - Translated.
##
## Declension should be avoided where possible, leaving the original
## brand unaltered in prominent UI positions.
##
## For further details, consult:
## https://mozilla-l10n.github.io/styleguides/mozilla_general/#brands-copyright-and-trademark

# Landmax Reader (rebrand plan, James 2026-10-05): "Reader" in the Library, "Landmax Reader" in full.
-brand-shorter-name = Reader
-brand-short-name = Reader
-brand-shortcut-name = Landmax Reader
-brand-full-name = Landmax Reader
# This brand name can be used in messages where the product name needs to
# remain unchanged across different versions (Nightly, Beta, etc.).
-brand-product-name = Landmax Reader
# Stays "Mozilla": nearly every use names Mozilla itself (its add-on rules, its account, its certificate list).
-vendor-short-name = Mozilla
trademarkInfo = Firefox is a trademark of the Mozilla Foundation. Landmax Reader is built on its open-source code.

## Landmax Reader's About window (rebrand plan, step 3)

# Variables: $reader (our version), $gecko (the engine's version), $isodate (build date)
landmax-about-version = Reader { $reader } (Gecko { $gecko }, { $isodate })
landmax-about-desc = Landmax Reader is part of Landmax Library. Updates come with Library. It is built on the open-source engine of Firefox, by Mozilla.
