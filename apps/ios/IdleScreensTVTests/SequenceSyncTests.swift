import XCTest
@testable import IdleScreensTV

/// Port of idle-server `site/src/lib/sequence-sync.test.ts` (`sequenceBaseT`,
/// `rebaseEpoch`): a sleep keeps its place on a `sync: 'epoch'` sequence's
/// shared clock, so a TV opened after a wake agrees with a web screen.
final class SequenceSyncTests: XCTestCase {

    /// 2 s + 3 s.
    private func seq(sync: String? = "epoch", loop: Bool = true) -> SequenceSubset {
        let syncField = sync.map { #""sync":"\#($0)","# } ?? ""
        return try! JSONDecoder().decode(SequenceSubset.self, from: Data("""
        {"format":"idle-sequence",\(syncField)"loop":\(loop),"segments":[
          {"key":"a","duration":2000,"scene":{"layers":[]}},
          {"key":"b","duration":3000,"scene":{"layers":[]}}
        ]}
        """.utf8))
    }

    private func at(_ ms: Double) -> Date { Date(timeIntervalSince1970: ms / 1000) }

    private func baseMs(_ s: SequenceSubset, epoch: Int?, now: Double,
                        _ pause: TVAppState.ChannelPause = .init()) -> Double {
        TVAppState.sequenceBaseT(s, epochMs: epoch, now: at(now), pause: pause) * 1000
    }

    // MARK: - sequenceBaseT

    func testZeroForMountSequenceAndWithoutEpoch() {
        XCTAssertEqual(baseMs(seq(sync: nil), epoch: 1000, now: 5000), 0)
        XCTAssertEqual(baseMs(seq(sync: "mount"), epoch: 1000, now: 5000), 0)
        XCTAssertEqual(baseMs(seq(), epoch: nil, now: 5000), 0)
    }

    func testNowMinusEpoch() {
        XCTAssertEqual(baseMs(seq(loop: false), epoch: 1000, now: 4500), 3500, accuracy: 1e-3)
    }

    func testWrapsIntoTheLoop() {
        XCTAssertEqual(baseMs(seq(), epoch: 0, now: 12_300), 2300, accuracy: 1e-3)
        XCTAssertEqual(baseMs(seq(), epoch: 0, now: 5000), 0, accuracy: 1e-3)
    }

    func testNeverNegative() {
        XCTAssertEqual(baseMs(seq(), epoch: 10_000, now: 9000), 0)
    }

    // MARK: - A sleep keeps its place

    func testTimeAsleepIsOffTheClockAfterAWake() {
        // 4 s in, slept 20 s, woke, 1 s later: 5 s of channel time, not 25.
        XCTAssertEqual(baseMs(seq(loop: false), epoch: 0, now: 25_000, .init(pausedMs: 20_000)), 5000, accuracy: 1e-3)
    }

    func testStandsStillAtTheSleepWhileAsleep() {
        let once = seq(loop: false)
        XCTAssertEqual(baseMs(once, epoch: 0, now: 9000, .init(sleptAt: 4000)), 4000, accuracy: 1e-3)
        XCTAssertEqual(baseMs(once, epoch: 0, now: 60_000, .init(sleptAt: 4000)), 4000, accuracy: 1e-3)
        // A second sleep: the first's 20 s stays off too.
        XCTAssertEqual(baseMs(once, epoch: 0, now: 60_000, .init(pausedMs: 20_000, sleptAt: 30_000)), 10_000, accuracy: 1e-3)
    }

    func testAgreesWithAScreenThatStayedOpen() {
        // A screen open through the sleep: it held at 4 s while asleep…
        let once = seq(loop: false)
        let held = baseMs(once, epoch: 0, now: 24_000, .init(sleptAt: 4000))
        XCTAssertEqual(held, 4000, accuracy: 1e-3)
        // …then played 1 s after the wake. A screen opened at that moment,
        // from the wake's pause total alone, lands on the same instant.
        let openedLater = baseMs(once, epoch: 0, now: 25_000, .init(pausedMs: 20_000))
        XCTAssertEqual(openedLater, held + 1000, accuracy: 1e-3)
    }

    func testWrapsALoopOnChannelTime() {
        XCTAssertEqual(baseMs(seq(), epoch: 0, now: 32_300, .init(pausedMs: 20_000)), 2300, accuracy: 1e-3)
    }

    func testMissingOrBrokenPauseCountsAsNone() {
        let once = seq(loop: false)
        XCTAssertEqual(baseMs(once, epoch: 0, now: 4500, .init()), 4500, accuracy: 1e-3)
        XCTAssertEqual(baseMs(once, epoch: 0, now: 4500, .init(pausedMs: -100)), 4500, accuracy: 1e-3)
    }

    func testNothingForAMountSequencePausedOrNot() {
        XCTAssertEqual(baseMs(seq(sync: "mount"), epoch: 0, now: 25_000, .init(pausedMs: 20_000)), 0)
        XCTAssertEqual(baseMs(seq(sync: "mount"), epoch: 0, now: 25_000, .init(sleptAt: 4000)), 0)
    }

    // MARK: - rebaseEpoch

    func testRebaseLeavesThePauseWhenTheEpochHasNotMoved() {
        let prev = TVAppState.ChannelPause(pausedMs: 20_000)
        XCTAssertEqual(prev.rebased(from: 1000, to: 1000, sleeping: false), prev)
        XCTAssertEqual(prev.rebased(from: 1000, to: nil, sleeping: false), prev)
    }

    func testRebaseDropsTheOldSleepOnANewEpoch() {
        XCTAssertEqual(TVAppState.ChannelPause(pausedMs: 20_000).rebased(from: 1000, to: 50_000, sleeping: false),
                       TVAppState.ChannelPause())
    }

    func testRebaseFreezesAnAsleepClockAtTheNewEpoch() {
        XCTAssertEqual(TVAppState.ChannelPause(pausedMs: 5000, sleptAt: 30_000).rebased(from: 1000, to: 50_000, sleeping: true),
                       TVAppState.ChannelPause(sleptAt: 50_000))
    }

    func testReseedTrackThenSeedEndsWithNoStalePause() {
        // The reseed broadcast order: track (new epoch) first, then seed (same epoch).
        let afterTrack = TVAppState.ChannelPause(pausedMs: 20_000).rebased(from: 1000, to: 50_000, sleeping: false)
        let afterSeed = afterTrack.rebased(from: 50_000, to: 50_000, sleeping: false)
        XCTAssertNil(afterSeed.pausedMs)
        let long = try! JSONDecoder().decode(SequenceSubset.self, from: Data("""
        {"format":"idle-sequence","sync":"epoch","segments":[{"duration":1000000,"scene":{"layers":[]}}]}
        """.utf8))
        XCTAssertEqual(baseMs(long, epoch: 50_000, now: 60_000, afterSeed), 10_000, accuracy: 1e-3)
    }

    // MARK: - Wire → app state

    func testSnapshotAndMessagesCarryThePause() {
        guard case .snapshot(let snap)? = ChannelWSClient.parse(
            #"{"type":"snapshot","epoch":0,"sleeping":true,"pausedMs":20000,"sleptAt":30000}"#) else {
            return XCTFail("snapshot did not parse")
        }
        XCTAssertEqual(snap.pausedMs, 20_000)
        XCTAssertEqual(snap.sleptAt, 30_000)
        XCTAssertEqual(ChannelWSClient.parse(#"{"type":"sleep","sleptAt":4000}"#), .sleep(sleptAt: 4000))
        XCTAssertEqual(ChannelWSClient.parse(#"{"type":"wake","pausedMs":20000}"#), .wake(pausedMs: 20_000))
        XCTAssertEqual(ChannelWSClient.parse(#"{"type":"sleep"}"#), .sleep(sleptAt: nil))
        // A negative sleep start is broken: read as missing, not as a clock frozen at 0.
        XCTAssertEqual(ChannelWSClient.parse(#"{"type":"sleep","sleptAt":-5}"#), .sleep(sleptAt: nil))
    }

    @MainActor
    func testAppStateTracksSleepWakeAndANewEpoch() {
        let baseURL = URL(string: "https://example.com")!
        let app = TVAppState(gallery: GalleryClient(baseURL: baseURL), mcp: MCPClient(baseURL: baseURL),
                             ws: ChannelWSClient(), pair: PairClient(baseURL: baseURL), baseURL: baseURL)
        app.handle(.snapshot(ChannelSnapshot(epoch: 1000, sleeping: false)))
        XCTAssertEqual(app.channelPause, .init())
        app.handle(.sleep(sleptAt: 5000))
        XCTAssertEqual(app.channelPause, .init(sleptAt: 5000))
        app.handle(.wake(pausedMs: 20_000))
        XCTAssertEqual(app.channelPause, .init(pausedMs: 20_000))
        // A reseed: track then seed with the new epoch — no stale pause.
        app.handle(.track(nil, epoch: 90_000))
        app.handle(.reseed(seed: 3, epoch: 90_000))
        XCTAssertEqual(app.channelPause, .init())
        XCTAssertEqual(app.channelEpochMs, 90_000)
        // A snapshot states the whole pause.
        app.handle(.snapshot(ChannelSnapshot(epoch: 90_000, sleeping: true, pausedMs: 7000, sleptAt: 95_000)))
        XCTAssertEqual(app.channelPause, .init(pausedMs: 7000, sleptAt: 95_000))
        // Asleep, a new epoch freezes the clock at it.
        app.handle(.reseed(seed: 4, epoch: 120_000))
        XCTAssertEqual(app.channelPause, .init(sleptAt: 120_000))
    }
    @MainActor
    func testATVOpenedAfterAWakeLandsWhereTheOpenScreensAre() throws {
        // 60 s + 60 s, epoch-synced. Published 80 s ago, asleep for 40 s of
        // that: channel time is 40 s (segment a), not 80 s (segment b).
        let baseURL = URL(string: "https://example.com")!
        let app = TVAppState(gallery: GalleryClient(baseURL: baseURL), mcp: MCPClient(baseURL: baseURL),
                             ws: ChannelWSClient(), pair: PairClient(baseURL: baseURL), baseURL: baseURL)
        let seqJSON = try JSONDecoder().decode(JSONValue.self, from: Data("""
        {"format":"idle-sequence","sync":"epoch","segments":[
          {"key":"a","duration":60000,"scene":{"layers":[]}},
          {"key":"b","duration":60000,"scene":{"layers":[]}}
        ]}
        """.utf8))
        let nowMs = Int(Date().timeIntervalSince1970 * 1000)
        app.handle(.snapshot(ChannelSnapshot(resolvedSpec: seqJSON, epoch: nowMs - 80_000, sleeping: false,
                                             now: nowMs, pausedMs: 40_000)))
        XCTAssertEqual(app.sequenceSegmentKey, "a")

        // Without the pause (an older server), the old behaviour: segment b.
        let old = TVAppState(gallery: GalleryClient(baseURL: baseURL), mcp: MCPClient(baseURL: baseURL),
                             ws: ChannelWSClient(), pair: PairClient(baseURL: baseURL), baseURL: baseURL)
        old.handle(.snapshot(ChannelSnapshot(resolvedSpec: seqJSON, epoch: nowMs - 80_000, sleeping: false, now: nowMs)))
        XCTAssertEqual(old.sequenceSegmentKey, "b")
    }
    @MainActor
    func testAPublishWakesAndAReseedKeepsTheSleep() throws {
        let baseURL = URL(string: "https://example.com")!
        let app = TVAppState(gallery: GalleryClient(baseURL: baseURL), mcp: MCPClient(baseURL: baseURL),
                             ws: ChannelWSClient(), pair: PairClient(baseURL: baseURL), baseURL: baseURL)
        let spec = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"layers":[]}"#.utf8))
        app.handle(.snapshot(ChannelSnapshot(epoch: 1000, sleeping: true, pausedMs: 0, sleptAt: 5000)))
        XCTAssertTrue(app.sleeping)
        // A reseed of an asleep channel: still asleep, its clock frozen at the new epoch.
        let reseed = try XCTUnwrap(ChannelWSClient.parse(
            #"{"type":"scene","spec":{"layers":[]},"seed":2,"epoch":9000,"sleeping":true,"sleptAt":9000}"#))
        app.handle(reseed)
        XCTAssertTrue(app.sleeping)
        XCTAssertEqual(app.channelPause, .init(sleptAt: 9000))
        // A sleeping scene with no epoch on an awake TV stands the clock at its sleptAt.
        let awake = TVAppState(gallery: GalleryClient(baseURL: baseURL), mcp: MCPClient(baseURL: baseURL),
                               ws: ChannelWSClient(), pair: PairClient(baseURL: baseURL), baseURL: baseURL)
        awake.handle(.snapshot(ChannelSnapshot(epoch: 1000, sleeping: false)))
        awake.handle(.scene(spec: spec, seed: 2, sleeping: true, sleptAt: 7000))
        XCTAssertTrue(awake.sleeping)
        XCTAssertEqual(awake.channelPause, .init(sleptAt: 7000))
        // A publish to an asleep channel wakes it; no `wake` message follows.
        app.handle(.scene(spec: spec, seed: 3, epoch: 20_000))
        XCTAssertFalse(app.sleeping)
        XCTAssertEqual(app.channelPause, .init())
    }
}
