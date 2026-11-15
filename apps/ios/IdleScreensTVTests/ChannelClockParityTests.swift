import XCTest
@testable import IdleScreensTV

/// The TV's shared clock against the server's own (idle-server
/// `src/channel-clock.ts` `channelElapsed`): seven histories of seeks, rates,
/// sleeps and wakes run through the TypeScript clock, each read at three wall
/// times, the same table the web viewer's parity test uses
/// (`site/src/lib/sequence-sync.test.ts`). Each row is the fields the server
/// sends screens and the channel time it reckons. Regenerate from the server
/// if `channelElapsed` changes.
final class ChannelClockParityTests: XCTestCase {

    private let epoch = 1000
    private let golden: [(pausedMs: Int?, sleptAt: Int?, playhead: Playhead?, now: Double, elapsed: Double)] = [
            (pausedMs: nil, sleptAt: nil, playhead: nil, now: 12000, elapsed: 11000),
            (pausedMs: nil, sleptAt: nil, playhead: nil, now: 15500, elapsed: 14500),
            (pausedMs: nil, sleptAt: nil, playhead: nil, now: 40000, elapsed: 39000),
            (pausedMs: nil, sleptAt: nil, playhead: Playhead(at: 3000, t: 2000, rate: 0, paused: 0), now: 12000, elapsed: 2000),
            (pausedMs: nil, sleptAt: nil, playhead: Playhead(at: 3000, t: 2000, rate: 0, paused: 0), now: 15500, elapsed: 2000),
            (pausedMs: nil, sleptAt: nil, playhead: Playhead(at: 3000, t: 2000, rate: 0, paused: 0), now: 40000, elapsed: 2000),
            (pausedMs: nil, sleptAt: nil, playhead: Playhead(at: 3000, t: 2000, rate: 0.5, paused: 0), now: 12000, elapsed: 6500),
            (pausedMs: nil, sleptAt: nil, playhead: Playhead(at: 3000, t: 2000, rate: 0.5, paused: 0), now: 15500, elapsed: 8250),
            (pausedMs: nil, sleptAt: nil, playhead: Playhead(at: 3000, t: 2000, rate: 0.5, paused: 0), now: 40000, elapsed: 20500),
            (pausedMs: nil, sleptAt: nil, playhead: Playhead(at: 4000, t: 12345, rate: 1, paused: 0), now: 12000, elapsed: 20345),
            (pausedMs: nil, sleptAt: nil, playhead: Playhead(at: 4000, t: 12345, rate: 1, paused: 0), now: 15500, elapsed: 23845),
            (pausedMs: nil, sleptAt: nil, playhead: Playhead(at: 4000, t: 12345, rate: 1, paused: 0), now: 40000, elapsed: 48345),
            (pausedMs: 3000, sleptAt: nil, playhead: Playhead(at: 11000, t: 700, rate: 0.5, paused: 3000), now: 12000, elapsed: 1200),
            (pausedMs: 3000, sleptAt: nil, playhead: Playhead(at: 11000, t: 700, rate: 0.5, paused: 3000), now: 15500, elapsed: 2950),
            (pausedMs: 3000, sleptAt: nil, playhead: Playhead(at: 11000, t: 700, rate: 0.5, paused: 3000), now: 40000, elapsed: 15200),
            (pausedMs: 3000, sleptAt: nil, playhead: Playhead(at: 5000, t: 1000, rate: 2, paused: 3000), now: 12000, elapsed: 15000),
            (pausedMs: 3000, sleptAt: nil, playhead: Playhead(at: 5000, t: 1000, rate: 2, paused: 3000), now: 15500, elapsed: 22000),
            (pausedMs: 3000, sleptAt: nil, playhead: Playhead(at: 5000, t: 1000, rate: 2, paused: 3000), now: 40000, elapsed: 71000),
            (pausedMs: nil, sleptAt: 3000, playhead: Playhead(at: 2000, t: 1000, rate: 0, paused: 0), now: 12000, elapsed: 1000),
            (pausedMs: nil, sleptAt: 3000, playhead: Playhead(at: 2000, t: 1000, rate: 0, paused: 0), now: 15500, elapsed: 1000),
            (pausedMs: nil, sleptAt: 3000, playhead: Playhead(at: 2000, t: 1000, rate: 0, paused: 0), now: 40000, elapsed: 1000),
        ]

    func testMatchesTheServerClockAcrossSeeksRatesAndSleeps() {
        for row in golden {
            let pause = TVAppState.ChannelPause(pausedMs: row.pausedMs, sleptAt: row.sleptAt, playhead: row.playhead)
            XCTAssertEqual(TVAppState.channelElapsedMs(epochMs: epoch, nowMs: row.now, pause: pause), row.elapsed,
                           accuracy: 1e-6, "\(row)")
        }
    }

    func testAPlayheadMountsASequenceWhereTheRoomIs() {
        // 2 s + 3 s, looping; paused at 7 s of channel time (2 s into the second lap).
        let seq = try! JSONDecoder().decode(SequenceSubset.self, from: Data("""
        {"format":"idle-sequence","sync":"epoch","loop":true,"segments":[
          {"key":"a","duration":2000,"scene":{"layers":[]}},
          {"key":"b","duration":3000,"scene":{"layers":[]}}
        ]}
        """.utf8))
        let pause = TVAppState.ChannelPause(playhead: Playhead(at: 8000, t: 7000, rate: 0, paused: 0))
        let later = Date(timeIntervalSince1970: 60)
        XCTAssertEqual(TVAppState.sequenceBaseT(seq, epochMs: 1000, now: later, pause: pause) * 1000, 2000, accuracy: 1e-6)
    }

    func testDecodesThePlayheadAndTheClockMessage() throws {
        let clock = try XCTUnwrap(ChannelWSClient.parse(#"{"type":"clock","epoch":5000,"playhead":{"at":9000,"t":4000,"rate":0,"paused":0},"pausedMs":120}"#))
        XCTAssertEqual(clock, .clock(epoch: 5000, playhead: Playhead(at: 9000, t: 4000, rate: 0, paused: 0), pausedMs: 120))
        // A malformed playhead is dropped, not trusted.
        let bad = try XCTUnwrap(ChannelWSClient.parse(#"{"type":"clock","epoch":5000,"playhead":{"at":9000,"t":"x","rate":0,"paused":0}}"#))
        XCTAssertEqual(bad, .clock(epoch: 5000, playhead: nil, pausedMs: nil))
        guard case .snapshot(let snap)? = ChannelWSClient.parse(#"{"type":"snapshot","epoch":5000,"playhead":{"at":1,"t":2,"rate":0.5,"paused":0}}"#) else { return XCTFail("not a snapshot") }
        XCTAssertEqual(snap.playhead?.rate, 0.5)
        guard case .scene(_, _, _, _, _, _, _, let pausedMs, let playhead)? = ChannelWSClient.parse(#"{"type":"scene","spec":{"layers":[]},"epoch":5000,"pausedMs":900,"playhead":{"at":1,"t":2,"rate":0,"paused":0}}"#) else { return XCTFail("not a scene") }
        XCTAssertEqual(pausedMs, 900)
        XCTAssertEqual(playhead?.rate, 0)
    }

    @MainActor
    func testTheTVFollowsAPauseAndASeek() throws {
        // 60 s + 60 s, epoch-synced, published 10 s ago: segment a, at rate 1.
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
        let epoch = nowMs - 10_000
        app.handle(.snapshot(ChannelSnapshot(resolvedSpec: seqJSON, epoch: epoch, sleeping: false, now: nowMs)))
        XCTAssertEqual(app.sequenceSegmentKey, "a")
        XCTAssertNil(app.sceneClock, "no playhead: the renderers keep their own clocks")
        // Paused 10 s in: the renderer clock holds there.
        app.handle(.clock(epoch: epoch, playhead: Playhead(at: Double(nowMs), t: 10_000, rate: 0, paused: 0), pausedMs: nil))
        XCTAssertEqual(app.sceneClock?.rate, 0)
        XCTAssertEqual(app.sceneClock?.t ?? -1, 10, accuracy: 0.5)
        // A seek to 90 s, still paused: segment b, 30 s into it.
        app.handle(.clock(epoch: epoch, playhead: Playhead(at: Double(nowMs), t: 90_000, rate: 0, paused: 0), pausedMs: nil))
        XCTAssertEqual(app.sequenceSegmentKey, "b")
        XCTAssertEqual(app.sceneClock?.t ?? -1, 30, accuracy: 0.5)
        // Half speed from there.
        app.handle(.clock(epoch: epoch, playhead: Playhead(at: Double(nowMs), t: 90_000, rate: 0.5, paused: 0), pausedMs: nil))
        XCTAssertEqual(app.sceneClock?.rate, 0.5)
        // A clock for another epoch (the scene has changed since) is ignored.
        app.handle(.clock(epoch: epoch - 1, playhead: Playhead(at: Double(nowMs), t: 0, rate: 1, paused: 0), pausedMs: nil))
        XCTAssertEqual(app.sceneClock?.rate, 0.5)
        // Asleep, the steered frame holds.
        app.handle(.sleep(sleptAt: nowMs + 1000))
        XCTAssertEqual(app.sceneClock?.rate, 0)
    }
}
