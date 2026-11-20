import XCTest

/// The remote paths that broke on the Channels and Settings tabs, driven with
/// the real Siri Remote (XCUIRemote). They read the live gallery, so run them
/// on demand against a simulator with a network connection:
///
///   xcodebuild test -scheme IdleScreensTVUITests -destination '…Apple TV…' \
///     -only-testing:IdleScreensTVUITests/TVNavigationTests
final class TVNavigationTests: XCTestCase {
    private func focusedLabel(_ app: XCUIApplication) -> String? {
        // firstMatch, not element(matching:): a focused cell and its button can
        // both report hasFocus, and resolving an ambiguous query fails the test.
        let el = app.descendants(matching: .any).matching(NSPredicate(format: "hasFocus == true")).firstMatch
        return el.exists ? el.label : nil
    }

    /// Launch on the Channels wall and wait for the gallery to take focus.
    /// `-tv.resume_on_launch NO` lands in UserDefaults' argument domain, so a
    /// saved "Start where I left off" can't reopen the last channel instead.
    private func launchOnWall() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-tv.resume_on_launch", "NO"]
        app.launch()
        // The tab bar can hold focus before the gallery arrives; wait until
        // focus is on the wall itself (the hero) rather than a fixed sleep.
        // Polled on the test's own thread, not via an NSPredicate block, which
        // XCTWaiter may evaluate off the main actor that XCUIElement lives on.
        let hasFocus = NSPredicate(format: "hasFocus == true")
        func onWall() -> Bool {
            app.descendants(matching: .any).matching(hasFocus).firstMatch.exists
                && !app.tabBars.descendants(matching: .any).matching(hasFocus).firstMatch.exists
        }
        let deadline = Date().addingTimeInterval(30)
        while !onWall(), Date() < deadline { usleep(500_000) }
        XCTAssertTrue(onWall(), "focus never reached the wall — gallery didn't load")
        sleep(1)                                   // let the hero settle
        return app
    }

    /// Down walks the whole wall. Each shelf was its own lazy grid, so the
    /// first shelf below the fold had built no cards and focus stopped on the
    /// last row of Featured — three presses in, every press after it ignored.
    func testDownKeepsScrollingPastTheFirstShelf() {
        let app = launchOnWall()
        var seen: [String] = []
        for _ in 0..<10 {
            XCUIRemote.shared.press(.down)
            usleep(900_000)
            if let label = focusedLabel(app), seen.last != label { seen.append(label) }
        }
        XCTAssertGreaterThanOrEqual(seen.count, 8, "focus stopped moving down the wall: \(seen)")
    }

    /// Settings → Pair iPhone → Back returns to Settings. The pairing screen
    /// had nothing to focus, so focus fell to the tab bar and Back left the
    /// app.
    func testBackFromPairingReturnsToSettings() {
        let app = launchOnWall()
        let remote = XCUIRemote.shared
        remote.press(.up); usleep(900_000)          // tab bar
        remote.press(.right); usleep(700_000)       // Search
        remote.press(.right); usleep(700_000)       // Settings
        remote.press(.down); usleep(1_200_000)      // into the form
        XCTAssertEqual(focusedLabel(app), "Pair iPhone")
        remote.press(.select); sleep(3)
        XCTAssertFalse(app.buttons["Pair iPhone"].exists, "the pairing screen opened")
        remote.press(.menu); sleep(2)
        XCTAssertEqual(app.state, .runningForeground, "Back left the app")
        XCTAssertEqual(focusedLabel(app), "Pair iPhone", "Back did not return to Settings")
    }
}
