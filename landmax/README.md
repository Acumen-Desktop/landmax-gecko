# Landmax Reader (Library): our files in this tree

The LL Reader is this fork of Firefox Nightly (`Acumen-Desktop/landmax-gecko`, branch `landmax`).
The plan and every decision: `docs/rebrand-plan.md` in `Acumen-Desktop/landmax-library`.

- `mozconfig.artifact`: daily builds on the iMac. Mozilla's ready-made engine, our front end (about a minute).
  The root `mozconfig` (ignored by git) just sources it.
- `mozconfig.full`: a full build, for when we change the engine's C++ (on the HP PC).
- `make-application-ini.sh`: an artifact build's engine still calls itself Firefox, so Library's launcher starts it
  with our identity file (`XUL_APP_FILE`): name `landmax-reader`, vendor Landmax Global, Wayland app id
  `global.landmax.reader`, profile folder `~/.landmax-reader`. Run after each build.
- `browser/branding/landmax/`: the name, icons and branding prefs.

Mozilla's `main` is merged into `landmax` regularly (rebrand plan, step 6). Keep our changes small and listed.
