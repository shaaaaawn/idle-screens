# Omarchy's plugin spec, and what it means for idle-screens

Research date: 2026-08-31. Sources: [Shell Plugins manual](https://omarchy.org/manual/shell-plugins/),
[plugins.omarchy.org/develop](https://plugins.omarchy.org/develop.html), and the
`basecamp/omarchy` `quattro` branch read directly via the GitHub API.

**Why this matters now.** Our Omarchy integration works by *cloning and patching a
first-party plugin* — a fork, which `packaging/omarchy/install-omarchy-plugin.sh`
already flags as losing upstream fixes. Omarchy now has a real, documented plugin
system with a git-URL install path. This doc asks whether that lets us stop
forking, and what else the spec's details oblige us to get right.

Short answer: **the spec does not yet remove the fork, because the screensaver
command is still hardcoded — but it makes a small upstream change the obvious
fix, and it hands us a distribution channel we aren't using.** Reading the source
also turned up a 3-second deadline we are not currently designing against.

---

## 1. What the spec actually is

A plugin is **a git repo with a `manifest.json` at its root**.

```json
{
  "schemaVersion": 1,
  "id": "io.github.yourname.plugin-name",
  "name": "...", "version": "...", "author": "...", "license": "...",
  "kinds": ["service"],
  "entryPoints": { "service": "Service.qml" }
}
```

| Kind | Entry point | What it is |
| --- | --- | --- |
| `bar-widget` | `barWidget` | An item the bar can drop into a section |
| `panel` | `panel` | A persistent or summoned floating window |
| `overlay` | `overlay` | A fullscreen surface |
| `menu` | `menu` | A summoned menu |
| **`service`** | **`service`** | **A headless singleton, no UI** |
| `bar` | `bar` | A full bar replacing the built-in one |

Commands:

```
omarchy plugin add <git-url> [--enable]   # install a third-party plugin
omarchy plugin clone <id> [--edit]        # fork a first-party plugin
omarchy plugin validate <path>            # manifest compliance
omarchy plugin enable|remove|update <id>
omarchy plugin list [--json]
```

Locations: first-party `$OMARCHY_PATH/shell/plugins/`, third-party
`~/.config/omarchy/plugins/<id>/`.

Rules worth knowing: the `omarchy.*` namespace is reserved and a third-party
plugin can never claim it; entry-point paths must be safe relative paths and the
files must exist; plugin folders may not contain symlinks; ids are unique, so an
install is refused if another plugin already claims one.

**Clone routing is a real feature, not a hack.** Per the manual, a clone takes
your username as a prefix (`dhh.clock`) and *"calls made to the original built-in
id get routed to your clone, so nothing that referred to `omarchy.clock` needs
updating."* That is exactly the mechanism our installer uses. Our README frames
it as a grudging workaround; the manual frames it as the supported override. Both
are true — it is supported, and it is still a fork.

**Plugins are unsandboxed.** They "share the long-running Omarchy shell process"
and run with full user permissions. The guide asks authors to avoid unnecessary
privileges and never spawn additional shell instances. Anything we ship here is
running inside the user's desktop shell — that raises the bar on what we put in
a `Service.qml`.

---

## 2. What changed under us since we wrote the integration

- **The idle plugin moved.** It is no longer `shell/plugins/idle/`; it now lives
  at `shell/plugins/services/idle/` alongside `battery`, `media` and
  `nightlight`. The manifest id is **still `omarchy.idle`**, so our installer's
  `omarchy plugin clone omarchy.idle` and its `$1 ~ /\.idle$/` match still work.
- But the move is the point: **upstream is actively restructuring this area**,
  which is precisely the risk a fork carries. Our clone pins a snapshot of a file
  that is being moved around.

---

## 3. What the idle service actually does (read from source)

From `shell/plugins/services/idle/Service.qml`. These are the facts that
constrain us, several of which are not in our README today.

**The screensaver command is still hardcoded.** There is no config key:

```qml
runProcess(screensaverProcess, "screensaver",
  "[[ $(omarchy-shell lock isLocked 2>/dev/null) == \"true\" ]] || omarchy-launch-screensaver")
```

So our core claim — "the idle service offers no config key for *which*
screensaver to run" — remains correct as of `quattro`. This is the single fact
that keeps us forking.

**`shell.json` exposes only timeouts.** The service reads
`shell.shellConfig.idle` for `screensaver` (default 150 s) and `lock`
(default 300 s). Nothing else.

**There is a 3-second deadline we must meet.** The service watches Hyprland
`openwindow` events for window class `org.omarchy.screensaver`, and:

```qml
Timer { id: screensaverLaunchGraceTimer; interval: 3000
  onTriggered: { ... root.cancelIdleCycle("screensaver-not-running") } }
```

If no window of that class has mapped within **3 s** of launch, the idle cycle is
cancelled — meaning **the screen never locks**. Our README says the service
"cancels the idle cycle if no such window appears" but does not name the budget.
It should, because 3 s is a real constraint for a GTK + WebKit process on slow
hardware. (We are probably fine today: `windows.rs` calls `present()` with
opacity 0 *before* the page loads, so the surface maps early. "Probably" is not
measured — see §6.)

**Dismissal is window-driven.** `handleScreensaverWindowClosed` cancels the
pending lock when our last window closes, treating it as user activity. So our
exit path is load-bearing for Omarchy's lock behaviour, not just for us.

**The lock timer runs concurrently**, not after. At 300 s `omarchy-system-lock`
runs over whatever is on screen. A kiosk/appliance setup on Omarchy therefore
needs the *lock* timeout addressed too, not just the screensaver one — the same
class of ordering bug as the swayidle/wlopm case, and we do not document it.

**`IdleMonitor { respectInhibitors: true }`** — so a media player's inhibitor
suppresses the whole cycle. Consistent with our decision not to ship an
inhibitor.

**`Process` commands run under `bash -lc`** — a *login* shell. This confirms why
a `~/.local/bin` PATH shim cannot win: login-shell PATH assembly is exactly where
`env-bootstrap` appends rather than prepends.

**There is an IPC surface**: `IpcHandler { target: "idle" }` with
`status`, `debug`, `enable`, `disable`, `toggle`. `omarchy-shell idle status`
returns a rich JSON blob (timers, process states, window count, `lastEvent`).
That is a much better debugging tool than we currently advertise.

---

## 4. The options, ranked

### A. Upstream a config key — highest leverage, kills the fork

Propose to `basecamp/omarchy` that the idle service read the screensaver command
from `shell.json`, defaulting to today's behaviour:

```qml
readonly property string screensaverCommand:
  (idleConfig.screensaverCommand && String(idleConfig.screensaverCommand).length)
    ? String(idleConfig.screensaverCommand) : "omarchy-launch-screensaver"
```

It is a handful of lines in one file, strictly backward compatible, and it
generalises past us — anyone wanting a different screensaver (xscreensaver
ports, a video wall, a corporate lock screen) needs the same hook. The idle
service already reads two config keys from that exact object, so this follows
the established pattern rather than inventing one.

If accepted, our installer collapses to editing `~/.config/omarchy/shell.json`:
no clone, no `sed` into QML, no drift, survives `omarchy update`. That is the
outcome worth pursuing first, because every other option below is a workaround
for its absence.

**Risk:** it is someone else's roadmap and may be declined (the hardcoded
`omarchy-shell lock isLocked` guard suggests they want tight control of this
path). Cheap to ask; the fallback is B/C.

### B. Publish as a marketplace plugin — do this regardless

There is a plugin marketplace (plugins.omarchy.org, plus a community
`omarchy-plugin-marketplace` repo) and a documented publish flow. Even while the
override still needs a clone, shipping
`github.com/shaaaaawn/omarchy-plugin-idle-screens` gives us
`omarchy plugin add <url> --enable` as a one-line install, a discoverable
listing, and `omarchy plugin update` for upgrades — replacing a curl-a-tarball
story with the platform's native one. Independent of A, and useful whether or
not A lands.

### C. Ship our own `service` plugin and disable `omarchy.idle`

The `service` kind is a headless QML singleton — enough to run our own
`IdleMonitor` and launch the saver ourselves, with no fork of anything.

Tempting, and wrong as a default. We would be reimplementing stay-awake state,
lock coordination, the isLocked guard, the wake process, and the window-class
bookkeeping — and inheriting the bug reports when our copy diverges from
Omarchy's lock behaviour. It also puts our code inside the user's shell process,
which the plugin guide explicitly cautions about.

Worth keeping as the fallback if A is declined *and* the clone becomes
unmaintainable. Not worth building speculatively.

### D. Status quo (clone + patch) — keep, but document the drift

Works today and is a documented Omarchy mechanism. The action item is honesty:
say in the README that the clone pins a file upstream is actively moving (it
already moved once), and give the re-clone recipe as routine maintenance rather
than a footnote.

---

## 5. Things to fix regardless of which option we take

1. **Document the 3-second window budget** in `apps/linux/README.md` — and that
   blowing it means the screen silently never locks, which reads as an Omarchy
   bug, not ours.
2. **Document the concurrent 300 s lock timer**, and what a kiosk user must do
   about it. Today our kiosk guidance covers hypridle and swayidle but says
   nothing about Omarchy's lock.
3. **Advertise `omarchy-shell idle status`** as the first debugging step; the
   JSON it returns names the exact failure (`screensaver-not-running`,
   `screensaver-dismissed`, `stay-awake`).
4. **Add `omarchy plugin validate` to our own checks.** Our installer already
   calls it post-patch; if we ship a plugin repo (B) it should run in CI.

---

## 6. Open questions — and how to settle them

| Question | How to answer |
| --- | --- |
| Do we map a window within 3 s on the slowest target (Pi 5)? | Time it: launch and watch `omarchy-shell idle status` for `screensaverWindows > 0`, or log a timestamp at `present()`. If it is marginal, map the surface before building the webview. |
| Would upstream take the config key? | Open a discussion on `basecamp/omarchy` referencing the two keys the service already reads. Cheap. |
| Is `omarchy plugin add` able to install a `service` plugin that *replaces* a first-party one, or only add alongside? | The manual documents clone-routing for overrides but not add-routing. Test on the Omarchy box. |
| Can a plugin declare its own `shell.json` keys? | Neither the manual nor the develop guide says. Read `omarchy-shell`'s config loader. Determines how a plugin from (B) would be configured. |
| Does our clone still apply cleanly after the `services/` move? | Re-run `install-omarchy-plugin.sh` on current Omarchy. Our `sed` targets a string, not a path, so it likely survives — but "likely" is why we test. |

---

## 7. Recommendation

Do **B** now (publish the plugin repo — pure upside, uses the platform's own
distribution), ask **A** immediately (small, generalises, and is the only option
that actually deletes the fork), keep **D** working meanwhile, and hold **C** in
reserve. Land the §5 documentation fixes independently of all four — they are
correct today regardless of how the plugin question resolves.
