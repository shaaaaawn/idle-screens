import XCTest
@testable import IdleScreens

@MainActor
final class FollowStoreTests: XCTestCase {
    private final class Box { var saved: [String]? }

    private func store(initial: [String]? = nil) -> (FollowStore, Box) {
        let box = Box(); box.saved = initial
        let store = FollowStore(storage: .init(load: { box.saved }, save: { box.saved = $0 }))
        return (store, box)
    }

    func testToggleFollowsThenUnfollows() {
        let (store, _) = store()
        XCTAssertTrue(store.toggle("lobby"))
        XCTAssertTrue(store.isFollowing("lobby"))
        XCTAssertFalse(store.toggle("lobby"))
        XCTAssertFalse(store.isFollowing("lobby"))
    }

    func testFollowsSurviveARelaunch() {
        let (first, box) = store()
        first.toggle("pottery"); first.toggle("lobby")
        let relaunched = FollowStore(storage: .init(load: { box.saved }, save: { box.saved = $0 }))
        XCTAssertEqual(relaunched.followed, ["pottery", "lobby"])
    }

    /// Two devices holding the same set must write the same bytes, or every
    /// sync looks like a change.
    func testStoredOrderIsStable() {
        let (a, boxA) = store(); a.toggle("b"); a.toggle("a"); a.toggle("c")
        let (b, boxB) = store(); b.toggle("c"); b.toggle("a"); b.toggle("b")
        XCTAssertEqual(boxA.saved, boxB.saved)
        XCTAssertEqual(boxA.saved, ["a", "b", "c"])
    }

    /// A followed channel that has been deleted simply drops out — no ghost
    /// card — and what remains keeps the feed's order.
    func testFollowingIsAFilterOverTheLiveWall() {
        let (store, _) = store(initial: ["old", "new", "deleted"])
        let wall = [
            PublicChannel(channelId: "old", label: nil, tags: nil, viewers: nil, lastEventAt: 100),
            PublicChannel(channelId: "new", label: nil, tags: nil, viewers: nil, lastEventAt: 300),
            PublicChannel(channelId: "stranger", label: nil, tags: nil, viewers: nil, lastEventAt: 999),
        ]
        XCTAssertEqual(store.channels(in: wall).map(\.id), ["new", "old"])
    }
}
