# iOS release runbook (TestFlight) — Idle Screens

CLI-only TestFlight uploads for `apps/ios` (bundle id `com.hermosalabs.idlescreens`).
First upload: 2026-07-25, build 1 (1.0.0), Delivery UUID 078f0ebb-caa4-40ba-a9d7-c2be08cf0de0.
Generic root-cause reference: user skill `testflight-cli-upload-fresh-org`; sibling runbook:
`farco-bolo/docs/ops/ios-release.md`.

## Fixed facts (this project)

| Thing | Value |
|---|---|
| Org / Team ID | `Z4P3N45225` (Hermosa Labs, LLC) |
| App bundle ID | `com.hermosalabs.idlescreens` (ASC bundleId resource `9B2CMN8834`) |
| App Store profile | `Idle Screens App Store v3` (adds Associated Domains for `/pair/` universal links; v1 references the marco cert, v2 predates the entitlement — both unused) |
| Distribution identity | `Apple Distribution: Hermosa Labs, LLC (Z4P3N45225)` cert `HT5T6FN8ZK`, private key lives ONLY in `~/Library/Keychains/idle-build.keychain-db` |
| Keychain password | `IDLE_BUILD_KEYCHAIN_PASSWORD` in the **farco-bolo repo-root `.env`** (gitignored; never commit the value) |
| App Store Connect app ID | `6794709335` (Idle Screens) |
| Issuer ID | `9b6efc9b-9a0b-46f5-82a3-40970ac04822` |
| API key | `G59H5KV568` ("claude code", Admin), `.p8` at `~/.appstoreconnect/private_keys/AuthKey_G59H5KV568.p8` |
| Signing config | `project.yml`: Debug = Automatic, Release = Manual (`Apple Distribution` + profile above). Regenerate with `xcodegen generate` — never hand-edit the pbxproj signing. |

## Recipe

```sh
cd apps/ios

# 1. Bump CURRENT_PROJECT_VERSION (and MARKETING_VERSION if new version) in project.yml, then:
xcodegen generate

# 2. Unlock the signing keychain (password from farco-bolo/.env, do not echo it)
set -a; . /Users/shawn/code/farco-bolo/.env; set +a
security unlock-keychain -p "$IDLE_BUILD_KEYCHAIN_PASSWORD" ~/Library/Keychains/idle-build.keychain-db
security find-identity -v -p codesigning ~/Library/Keychains/idle-build.keychain-db  # expect 1 valid identity

# 3. Archive (Release, manual)
xcodebuild archive -project IdleScreens.xcodeproj -scheme IdleScreens -configuration Release \
  -destination 'generic/platform=iOS' -archivePath /tmp/IdleScreens.xcarchive \
  OTHER_CODE_SIGN_FLAGS="--keychain $HOME/Library/Keychains/idle-build.keychain-db"

# 4. Export (ExportOptions.plist: method app-store-connect, teamID Z4P3N45225, signingStyle manual,
#    signingCertificate Apple Distribution, provisioningProfiles { com.hermosalabs.idlescreens: Idle Screens App Store v2 })
xcodebuild -exportArchive -archivePath /tmp/IdleScreens.xcarchive -exportPath /tmp/idle-export \
  -exportOptionsPlist /tmp/IdleScreens-ExportOptions.plist \
  OTHER_CODE_SIGN_FLAGS="--keychain $HOME/Library/Keychains/idle-build.keychain-db"

# 5. ALWAYS validate, then upload
xcrun altool --validate-app -f /tmp/idle-export/IdleScreens.ipa -t ios --apiKey G59H5KV568 --apiIssuer 9b6efc9b-9a0b-46f5-82a3-40970ac04822
xcrun altool --upload-app   -f /tmp/idle-export/IdleScreens.ipa -t ios --apiKey G59H5KV568 --apiIssuer 9b6efc9b-9a0b-46f5-82a3-40970ac04822
# Build appears in TestFlight after ~5–15 min processing; then add it to a testing group in ASC.
```

## Gotchas hit on the first upload (2026-07-25)

- **`errSecInternalComponent` on CodeSign** with the identity visible → keychain locked for
  private-key access. Unlock in the SAME shell right before archiving; it can also mean a missing
  `set-key-partition-list` (already applied to `idle-build.keychain-db` at creation).
- **marco-build.keychain-db password drift:** `KEYCHAIN_PASSWORD` in farco-bolo/.env unlocked it
  once, then started failing with "passphrase not correct" — treated as unrecoverable; that's why
  this project has its OWN cert + keychain instead of sharing marco's. If you fix the marco
  keychain, keep using `idle-build` for this app anyway (org distribution-cert slots are limited —
  do NOT mint a third cert; there are already two: marco's `83JPZQ86DK` and this one `HT5T6FN8ZK`).
- **App record cannot be created via API** (`POST /v1/apps` → 403). The `Idle Screens` app record
  was created by hand in the ASC web UI (one-time).
- **1024px marketing icon must be opaque** (no alpha) — `IdleScreens/Assets.xcassets/AppIcon.appiconset/icon-1024.png` is RGB, regenerated via PIL if ever needed.
- **Duplicate build numbers rejected** → bump `CURRENT_PROJECT_VERSION` every upload.
- **Lower-than-existing build numbers can be dropped SILENTLY** (2026-07-26): if a higher
  build already exists for the platform (e.g. a parallel session moved to the next day's
  `YYYYMMDDnn` series), altool may still report "No errors uploading" — the build then
  never appears in ASC (rejection email only). Before uploading, check the CURRENT max
  build via `GET /v1/builds?filter[app]=…&sort=-uploadedDate` and number above it.
  With multiple sessions shipping in parallel, always re-check right before upload.
- **401 on validate/upload** → wrong Key ID/Issuer for the `.p8`; re-check the key's row in ASC → Users and Access → Integrations.

## tvOS (added 2026-07-25)

Same app record (Apple ID `6794709335`), same bundle id, same dist cert + `idle-build.keychain-db`.
First tvOS upload: build `2026072501` (1.0.0), Delivery UUID `55935a1f-7325-4dcf-a105-5542320cd0c5`.

| Thing | Value |
|---|---|
| Target / scheme | `IdleScreensTV` (tvOS 17.0, device family 3) |
| Profile | `Idle Screens tvOS App Store` (`TVOS_APP_STORE` — iOS profiles can't sign tvOS) |
| Icon | `App Icon & Top Shelf Image.brandassets` (layered imagestack — **required** on tvOS) |

Recipe: same as iOS but `-scheme IdleScreensTV -destination 'generic/platform=tvOS'`,
ExportOptions profile `Idle Screens tvOS App Store`, and `altool -t appletvos`.
TestFlight on tvOS needs **no device registration**; a direct-from-Xcode debug run would need
the Apple TV UDID registered (`POST /v1/devices`).

Gotcha hit on first tvOS upload: **90513 `CFBundleIcons.CFBundlePrimaryIcon` missing** —
adding tv idiom slots to the iOS-style `AppIcon.appiconset` is NOT enough. tvOS requires the
brand-asset structure (`App Icon & Top Shelf Image.brandassets` with Back/Middle/Front
imagestack layers at 1280x768 + 400x240, plus 1920x720 / 2320x720 Top Shelf images) and
`ASSETCATALOG_COMPILER_APPICON_NAME: App Icon & Top Shelf Image` on the tvOS target only.
Brand-asset art is generated (build 2026072508+) by `idle-mono/scripts/make-app-icon.py` —
seeded, reproducible; renders the iOS 1024 icon, true parallax layers (Back opaque field,
Middle halo, Front ring, both with alpha), and all four Top Shelf sizes.
**Imagestack gotcha:** in an imagestack's `Contents.json`, the FIRST layer listed is the
front-most and the LAST must be fully opaque. The scaffolded stacks listed
`[Back, Middle, Front]` — inverted — which flat opaque placeholders masked; transparent
layers surface it as actool error "last image stack layer … must be a fully opaque bitmap".

Build numbers are date-based (`YYYYMMDDnn`, monotonic by construction) in both targets — no
manual bumping needed; rebuilds are always accepted.

## Store listing screenshots (added 2026-07-25)

The 1.0 listings (iOS + tvOS, `PREPARE_FOR_SUBMISSION`) have screenshots uploaded via the
mono-level pipeline: `idle-mono/scripts/store-shots/` captures/composes into
`idle-mono/store-assets/`, and `asc-upload.mjs` there pushes them to ASC (idempotent).
Slots filled: iPhone 6.9" + 6.5" (watch grid), Apple TV (4 shots, 4K). TestFlight itself
never needed these — they're for the eventual App Store submission.
