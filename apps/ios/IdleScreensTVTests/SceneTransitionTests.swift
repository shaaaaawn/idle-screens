import XCTest
@testable import IdleScreensTV

/// A live scene message's `transition` (idle-server transition.ts) and the
/// dissolve the TV plays for it.
final class SceneTransitionTests: XCTestCase {
    func testParsesTheScenesTransition() throws {
        let fade = ChannelWSClient.parse(#"{"type":"scene","spec":{"id":"warp"},"seed":3,"transition":{"type":"fade","dur":2000}}"#)
        guard case .scene(_, let seed, let transition, _)? = fade else { return XCTFail("not a scene: \(String(describing: fade))") }
        XCTAssertEqual(seed, 3)
        XCTAssertEqual(transition, SceneTransition(kind: .fade, dur: 2000))

        let plain = ChannelWSClient.parse(#"{"type":"scene","spec":{"id":"warp"},"seed":3}"#)
        guard case .scene(_, _, let none, _)? = plain else { return XCTFail("not a scene") }
        XCTAssertNil(none)

        // Malformed values are dropped, not trusted: the server refuses them first.
        XCTAssertNil(SceneTransition(.object(["type": .string("wipe")])))
        XCTAssertEqual(SceneTransition(.object(["type": .string("fade"), "dur": .int(99_999)]))?.dur, 10_000)
    }

    func testDissolveLength() {
        XCTAssertEqual(SceneTransition.seconds(for: nil), 0.8)
        XCTAssertEqual(SceneTransition.seconds(for: SceneTransition(kind: .cut)), 0)
        XCTAssertEqual(SceneTransition.seconds(for: SceneTransition(kind: .fade, dur: 3000)), 3)
        XCTAssertEqual(SceneTransition.seconds(for: SceneTransition(kind: .morph)), 0.8)
        // Two renderers overlap during a dissolve: short on the pre-4K boxes.
        XCTAssertEqual(TVAppState.crossfadeSeconds(SceneTransition(kind: .fade, dur: 3000), renderClass: .legacy), 0.4)
        XCTAssertEqual(TVAppState.crossfadeSeconds(SceneTransition(kind: .fade, dur: 3000), renderClass: .standard), 3)
    }
}
