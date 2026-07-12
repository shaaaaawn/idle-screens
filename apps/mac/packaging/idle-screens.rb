# Homebrew cask for the idle-screens Mac app.
# Install with a tap: `brew install --cask shaaaaawn/tap/idle-screens`
# (Requires a homebrew-tap repo hosting this file under Casks/.)
# Update `version` and `sha256` on each release; the notarize script prints the
# DMG's SHA-256.
cask "idle-screens" do
  version "0.1.0"
  sha256 :no_check # replace with the release DMG's SHA-256

  url "https://github.com/shaaaaawn/idle-screens/releases/download/mac-v#{version}/IdleScreens.dmg"
  name "idle-screens"
  desc "Menu-bar screensaver that renders the idle-screens web engine"
  homepage "https://idlescreens.com"

  app "IdleScreens.app"

  zap trash: [
    "~/Library/Preferences/com.idlescreens.mac.plist",
  ]
end
