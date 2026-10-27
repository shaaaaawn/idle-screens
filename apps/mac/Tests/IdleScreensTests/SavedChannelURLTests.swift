import XCTest

@testable import IdleScreens

/// The channel the next saver session opens. Greptile on #322: a push that
/// arrived while the saver showed never reached the stored config, so the
/// next session started on the old channel. The push now always updates it.
final class SavedChannelURLTests: XCTestCase {
  func testAPinnedSceneRidesWithItsOwnChannel() {
    let url = AppDelegate.savedChannelURL(
      channelId: "lobby", pushedScene: (channelId: "lobby", sceneId: 7))
    XCTAssertEqual(url?.path, "/channel/lobby")
    XCTAssertTrue(url?.query?.contains("scene=7") ?? false)
  }

  func testAPinnedSceneOfAnotherChannelIsDropped() {
    let url = AppDelegate.savedChannelURL(
      channelId: "studio", pushedScene: (channelId: "lobby", sceneId: 7))
    XCTAssertEqual(url?.path, "/channel/studio")
    XCTAssertFalse(url?.query?.contains("scene=") ?? true)
  }

  func testNoChannelMeansTheBundledSavers() {
    XCTAssertNil(AppDelegate.savedChannelURL(channelId: nil, pushedScene: nil))
    XCTAssertNil(AppDelegate.savedChannelURL(channelId: "", pushedScene: nil))
  }
}
