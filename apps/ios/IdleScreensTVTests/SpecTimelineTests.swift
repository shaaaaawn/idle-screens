import XCTest
@testable import IdleScreensTV

/// `timeline` keyframes, resolved natively. Fixtures/timeline-golden.json is
/// the schema's own `resolveTimelineAt` over the live `default` and grok-bot
/// specs (2026-10-17) and a synthetic spec that exercises every rule (loop
/// wrap, overlapping glides, step/linear/smooth, colour, whole-`transform`
/// and count glides, unresolvable and non-target paths), at times across and
/// beyond a lap. The TV must produce the same scene at every one.
final class SpecTimelineTests: XCTestCase {

    private struct Golden: Decodable {
        struct Row: Decodable { let name: String; let t: Double; let resolved: JSONValue }
        let specs: [String: JSONValue]
        let out: [Row]
    }

    private static let golden: Golden = {
        let url = Bundle(for: SpecTimelineTests.self).url(forResource: "timeline-golden", withExtension: "json")!
        return try! JSONDecoder().decode(Golden.self, from: Data(contentsOf: url))
    }()

    func testEveryResolutionMatchesTheEngine() {
        XCTAssertGreaterThanOrEqual(Self.golden.out.count, 60)
        for row in Self.golden.out {
            let spec = Self.golden.specs[row.name]!
            let got = SpecTimeline.resolve(spec, at: row.t)
            if let diff = Self.firstDifference(got, row.resolved, path: "") {
                XCTFail("\(row.name) at t=\(row.t): \(diff)")
            }
        }
    }

    func testResolvedScenesDecodeAndCompile() throws {
        for row in Self.golden.out where row.name != "synthetic-noloop" {
            let data = try JSONEncoder().encode(SpecTimeline.resolve(Self.golden.specs[row.name]!, at: row.t))
            let spec = try JSONDecoder().decode(SpecSubset.self, from: data)
            XCTAssertFalse(spec.compile(seed: 1).isEmpty, "\(row.name) at \(row.t)")
        }
    }

    func testASceneWithoutATimelineIsUntouched() {
        let plain: JSONValue = .object(["layers": .array([])])
        XCTAssertEqual(SpecTimeline.resolve(plain, at: 5000), plain)
        XCTAssertFalse(SpecTimeline.hasTimeline(plain))
        XCTAssertNil(SpecTimeline.nextChange(plain, after: 0))
    }

    func testNextChangeWakesForGlidesAndKeys() {
        let spec = Self.golden.specs["synthetic"]!
        XCTAssertEqual(SpecTimeline.nextChange(spec, after: 500), 500, "a glide is in flight")
        // Between keys: the 7000 key (origin, not a target) still counts as a key time.
        let hold = SpecTimeline.nextChange(spec, after: 9_500)!
        XCTAssertEqual(hold, 10_000, accuracy: 1e-9, "the loop wraps to the first key at t=0 of the next lap")
        var once = spec
        if case .object(var root) = once, case .object(var tl)? = root["timeline"] {
            tl["loop"] = .bool(false); root["timeline"] = .object(tl); once = .object(root)
        }
        XCTAssertNil(SpecTimeline.nextChange(once, after: 20_000), "a finished one-shot never moves again")
    }

    // MARK: - JSON comparison (numbers by value, int == double)

    static func firstDifference(_ a: JSONValue, _ b: JSONValue, path: String) -> String? {
        switch (a, b) {
        case (.object(let x), .object(let y)):
            if Set(x.keys) != Set(y.keys) {
                return "\(path): keys \(x.keys.sorted()) vs \(y.keys.sorted())"
            }
            for k in x.keys.sorted() {
                if let d = firstDifference(x[k]!, y[k]!, path: path + "." + k) { return d }
            }
            return nil
        case (.array(let x), .array(let y)):
            guard x.count == y.count else { return "\(path): \(x.count) vs \(y.count) items" }
            for i in x.indices {
                if let d = firstDifference(x[i], y[i], path: path + "[\(i)]") { return d }
            }
            return nil
        default:
            if a.isNumber, b.isNumber, let x = a.number, let y = b.number {
                return abs(x - y) <= 1e-9 * max(1, abs(y)) ? nil : "\(path): \(x) vs \(y)"
            }
            return a == b ? nil : "\(path): \(a) vs \(b)"
        }
    }
}
