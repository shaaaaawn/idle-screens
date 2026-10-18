import XCTest

/// Drives the real Siri Remote path (XCUIRemote) down and across the channel
/// grid while the app's debug RenderProbe logs what each move cost. Not a
/// pass/fail suite — a measuring tool for focus/scroll performance on the
/// grid (run it with the sprite tier pinned to see the pre-4K path).
///
///   xcodebuild test -scheme IdleScreensTVUITests -destination '…Apple TV…'
///   then read: log show --predicate 'category == "render-probe"'
final class FocusSwipeProbe: XCTestCase {
    func testSwipeDownTheGrid() {
        let app = XCUIApplication()
        app.launchArguments = ["-probeswipes"]
        app.launch()
        sleep(6)                                  // gallery load + first paint
        let remote = XCUIRemote.shared
        for _ in 0..<10 {
            remote.press(.down)
            usleep(700_000)
        }
        for _ in 0..<4 {
            remote.press(.right)
            usleep(500_000)
        }
        for _ in 0..<10 {
            remote.press(.up)
            usleep(400_000)
        }
        sleep(1)
    }
}
