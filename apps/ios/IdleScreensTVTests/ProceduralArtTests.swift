import XCTest
@testable import IdleScreensTV

final class ProceduralArtTests: XCTestCase {
    func testSeedHashIsDeterministic() {
        XCTAssertEqual(ProceduralChannelArt.seed(for: "lobby"),
                       ProceduralChannelArt.seed(for: "lobby"))
    }

    func testDifferentChannelsGetDifferentSeeds() {
        let seeds = ["lobby", "studio", "default", "aurora", "fish"]
            .map(ProceduralChannelArt.seed(for:))
        XCTAssertEqual(Set(seeds).count, seeds.count)
    }
}
