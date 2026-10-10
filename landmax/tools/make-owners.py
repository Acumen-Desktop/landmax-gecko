#!/usr/bin/env python3
"""Writes browser/components/landmax/owners.json: every known web domain -> the company that owns it, for Clean
(a site's own other domains are the site, not outside companies) and for naming companies in the Clean panel.
Merges DuckDuckGo's Tracker Radar entity map (first) and Disconnect's entities list (fills gaps).
Run again to refresh: python3 landmax/tools/make-owners.py"""
import json, os, urllib.request

DDG = "https://raw.githubusercontent.com/duckduckgo/tracker-radar/main/build-data/generated/entity_map.json"
DISCONNECT = "https://raw.githubusercontent.com/disconnectme/disconnect-tracking-protection/master/entities.json"


def get(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)


owners = {}
for name, e in get(DDG).items():
    for d in e.get("properties", []):
        owners.setdefault(d.lower(), e.get("displayName") or name)
for name, e in get(DISCONNECT)["entities"].items():
    for d in e.get("properties", []) + e.get("resources", []):
        owners.setdefault(d.lower(), name)

# Companies as numbers, so the file stays small: {"companies": [...], "domains": {domain: index}}.
companies = sorted(set(owners.values()))
index = {c: i for i, c in enumerate(companies)}
out = {"companies": companies, "domains": {d: index[c] for d, c in sorted(owners.items())}}
path = os.path.join(os.path.dirname(__file__), "..", "..", "browser", "components", "landmax", "owners.json")
with open(path, "w") as f:
    json.dump(out, f, separators=(",", ":"))
print(f"{len(owners)} domains, {len(companies)} companies -> {os.path.normpath(path)}")
