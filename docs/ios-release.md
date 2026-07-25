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
| App Store profile | `Idle Screens App Store v2` (v1 references the marco cert — unused) |
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
- **401 on validate/upload** → wrong Key ID/Issuer for the `.p8`; re-check the key's row in ASC → Users and Access → Integrations.
