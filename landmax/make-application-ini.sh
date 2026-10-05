#!/bin/sh
# Writes browser/application.ini with Landmax Reader's identity, next to an artifact build's engine.
# The launcher starts the engine with XUL_APP_FILE=<dist>/browser/application.ini (rebrand plan, step 2).
# Usage: landmax/make-application-ini.sh [objdir]   (default obj-landmax-artifact)
set -e
dist="${1:-obj-landmax-artifact}/dist/bin"
sed -e 's/^Vendor=.*/Vendor=Landmax Global/' \
    -e 's/^Name=.*/Name=landmax-reader/' \
    -e 's/^RemotingName=.*/RemotingName=global.landmax.reader/' \
    -e '/^Profile=/d' -e '/^Version=/a Profile=landmax-reader' \
    -e 's|^SourceRepository=.*|SourceRepository=https://github.com/Acumen-Desktop/landmax-gecko|' \
    "$dist/application.ini" > "$dist/browser/application.ini"
echo "wrote $dist/browser/application.ini"
