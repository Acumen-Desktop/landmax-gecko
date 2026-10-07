# Tests

`marionette.py PORT 'JS'`: runs async chrome JS in a running Reader and prints the result. Start Reader with
`--marionette`, a `user.js` holding `user_pref("marionette.port", PORT)`, and `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1` in the
environment (the `--remote-allow-system-access` flag isn't enough in an artifact build). The JS ends by calling
`arguments[arguments.length-1](value)`.

In the sandbox (`vm/nest.sh` in landmax-library), also set `XDG_DATA_HOME` (and the config and cache ones) to the
sandbox's home: `nest.sh run` keeps the real session's values, so a site app's `.desktop` file would land in James's
real Applications menu.
