import XCTest
@testable import IdleScreensTV

/// Live steering beyond the plain glide: the steering rule on a timeline
/// scene (a steer holds until its path's next key, then glides back), a
/// publish's own glide mounting at the base, and a reseed.
@MainActor
final class SteeringRuleTests: XCTestCase {

    private func json(_ text: String) -> JSONValue {
        try! JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
    }

    private let timed = ##"""
    {"seed":3,"layers":[{"key":"dot","count":1,"position":{"x":0.5,"y":0.5},"opacity":1,"sprite":{"kind":"circle","radius":[0.02,0.02],"color":"#ffffff"},"motion":{"type":"static"}},
                        {"key":"ring","count":1,"position":{"x":0.2,"y":0.2},"sprite":{"kind":"ring","radius":[0.02,0.02],"color":"#ffffff"},"motion":{"type":"static"}}],
     "timeline":{"keys":[{"t":5000,"path":"dot.opacity","value":0.2,"dur":1000}]}}
    """##

    func testASteerHoldsUntilThePathsNextKeyThenGlidesBack() {
        let spec = json(timed)
        let o = SpecTimeline.Override(spec: spec, path: "layers.0.opacity", from: .double(1), to: .double(0.5),
                                      now: 1000, glide: 1000, ease: nil)
        XCTAssertEqual(o.until, 5000)
        XCTAssertEqual(o.outDur, 1000)
        XCTAssertEqual(o.value(at: 1500, timeline: { .double(1) })?.number ?? 0, 0.75, accuracy: 1e-9, "gliding in")
        XCTAssertEqual(o.value(at: 4000, timeline: { .double(1) })?.number, 0.5, "held")
        XCTAssertEqual(o.value(at: 5500, timeline: { .double(0.6) })?.number ?? 0, 0.55, accuracy: 1e-9, "gliding back")
        XCTAssertNil(o.value(at: 6100, timeline: { .double(0.2) }), "handed back to the timeline")
        // A path no key touches holds for good.
        let sticky = SpecTimeline.Override(spec: spec, path: "layers.1.sprite.color", from: .string("#ffffff"),
                                           to: .string("#000000"), now: 1000, glide: 0, ease: nil)
        XCTAssertEqual(sticky.until, .infinity)
        XCTAssertEqual(sticky.value(at: 99_999, timeline: { nil }), .string("#000000"))
    }

    func testOverridesWriteOverTheResolvedFrame() {
        let spec = json(timed)
        let o = SpecTimeline.Override(spec: spec, path: "layers.1.sprite.color", from: nil, to: .string("#00ff00"),
                                      now: 0, glide: 0, ease: nil)
        let (frame, live) = SpecTimeline.applyOverrides(SpecTimeline.resolve(spec, at: 100), ["layers.1.sprite.color": o], at: 100)
        XCTAssertEqual(SpecTimeline.read(frame, "layers.1.sprite.color"), .string("#00ff00"))
        XCTAssertEqual(live.count, 1)
    }

    func testAPublishGlideMountsAtTheBaseAndKeptSteersAtOnce() {
        let track = json(##"{"deltas":[{"t":0,"path":"layers.0.sprite.color","value":"#ff0000","fromPublish":true,"dur":4000},{"t":1,"path":"layers.0.alpha","value":[0.5,0.5]}]}"##)
        let mount = TVAppState.mountDeltas(track) ?? []
        XCTAssertEqual(mount.map(\.path), ["layers.0.alpha"], "the publish glide is left out of the mount")
        let scene = json(##"{"spec":{"layers":[{"count":1,"alpha":[1,1],"sprite":{"kind":"circle","color":"#ffffff"},"motion":{"type":"static"}}]},"track":{}}"##)
        let base = TVAppState.publishMount(scene, track: track)
        XCTAssertEqual(SpecTimeline.read(base!, "layers.0.sprite.color"), .string("#ffffff"))
        XCTAssertEqual(SpecTimeline.read(base!, "layers.0.alpha"), json("[0.5,0.5]"))
        XCTAssertNil(TVAppState.publishMount(scene, track: json(##"{"deltas":[{"t":1,"path":"layers.0.alpha","value":[0.5,0.5]}]}"##)),
                     "nothing to glide: the snapshot's resolved spec is used")
    }

    func testWsParsesReseedAndTheSceneTrack() {
        guard case .reseed(let seed, let epoch)? = ChannelWSClient.parse(##"{"type":"seed","seed":77,"epoch":123}"##) else {
            return XCTFail("seed message")
        }
        XCTAssertEqual(seed, 77); XCTAssertEqual(epoch, 123)
        guard case .scene(_, _, _, _, let track)? = ChannelWSClient.parse(##"{"type":"scene","spec":{"layers":[]},"track":{"deltas":[]}}"##) else {
            return XCTFail("scene message")
        }
        XCTAssertNotNil(track)
    }
}
