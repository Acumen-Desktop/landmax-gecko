#!/bin/sh
# Writes browser/application.ini with Landmax Reader's identity, next to an artifact build's engine.
# The launcher starts the engine with XUL_APP_FILE=<dist>/browser/application.ini (rebrand plan, step 2).
# UAName=Firefox: websites see plain Firefox 159 (rebrand plan, step 0 question 6); without it the user agent
# says landmax-reader/159.0a1 and Google serves its basic, light-only sign-in page.
# Usage: landmax/make-application-ini.sh [objdir]   (default obj-landmax-artifact)
set -e
dist="${1:-obj-landmax-artifact}/dist/bin"
sed -e 's/^Vendor=.*/Vendor=Landmax Global/' \
    -e 's/^Name=.*/Name=landmax-reader/' \
    -e '/^Name=/a UAName=Firefox' \
    -e 's/^RemotingName=.*/RemotingName=global.landmax.reader/' \
    -e '/^Profile=/d' -e '/^Version=/a Profile=landmax-reader' \
    -e 's|^SourceRepository=.*|SourceRepository=https://github.com/Acumen-Desktop/landmax-gecko|' \
    "$dist/application.ini" > "$dist/browser/application.ini"
echo "wrote $dist/browser/application.ini"
