import SwiftUI
import XCTest
@testable import IdleScreensTV

/// The TV tank and the browser's lofi tank (packages/saver-metaquarium
/// lofi.ts + lofi-extras.ts) lay out the same tank for the same inputs:
/// fish, kelp, bubbles, room palette, critters, snow, lanterns and shoal,
/// and the same poses over time. Fixtures/tank-golden.json is the browser's
/// own output; regenerate it from buildLofiField when either side changes.
final class TankParityTests: XCTestCase {

    private struct Golden: Decodable {
        struct RGB: Decodable { let r: Double; let g: Double; let b: Double }
        struct Palette: Decodable { let top: RGB; let mid: RGB; let deep: RGB; let kelp: RGB; let dune: RGB; let shaftAlpha: Double }
        struct Fish: Decodable { let breed: String; let depth, lane, period, phase, dir, bobAmp, bobHz, bobPhase: Double }
        struct Kelp: Decodable { let x, height, width, swayPhase: Double }
        struct Bubble: Decodable { let x, period, phase, drift: Double }
        struct Critter: Decodable { let breed: String; let depth, lane, period, phase, dir, bobAmp, bobHz, bobPhase: Double }
        struct Mote: Decodable { let x, y, fall, sway, r: Double }
        struct Lantern: Decodable { let x, y, drift, pulse, r: Double }
        struct ShoalFish: Decodable { let dx, dy, wiggle: Double }
        struct Extras: Decodable { let critters: [Critter]; let snow: [Mote]; let lanterns: [Lantern]; let shoal: [ShoalFish]; let shoalLane: Double }
        struct XY: Decodable { let x: Double; let y: Double }
        struct CritterPose: Decodable { let x, y, side, alpha: Double }
        struct LanternPose: Decodable { let x, y, glow: Double }
        struct Pose: Decodable { let t: Double; let critters: [CritterPose]; let snow: [XY]; let lanterns: [LanternPose]; let shoal: XY }
        let seed: Double
        let rich: Bool
        let env: String
        let mix: String
        let p: [String: JSONValue]
        let fish: [Fish]
        let kelp: [Kelp]
        let bubbles: [Bubble]
        let palette: Palette
        let flora: Double?
        let extras: Extras
        let poses: [Pose]
    }

    private static let golden: [Golden] = {
        let url = Bundle(for: TankParityTests.self).url(forResource: "tank-golden", withExtension: "json")!
        return try! JSONDecoder().decode([Golden].self, from: Data(contentsOf: url))
    }()

    private func params(_ p: [String: JSONValue]) -> [String: String] {
        p.compactMapValues { v in
            switch v {
            case .string(let s): return s
            case .int(let i): return String(i)
            case .double(let d): return String(d)
            default: return nil
            }
        }
    }

    private func field(_ g: Golden) -> AquariumField {
        AquariumField(seed: UInt32(g.seed), tier: g.rich ? .t3 : .t2, environment: g.env,
                      fishMix: g.mix, params: AquariumParams(params(g.p)))
    }

    private func close(_ a: Double, _ b: Double, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(a, b, accuracy: 1e-9 * max(1, abs(b)), what, file: file, line: line)
    }

    func testTheTVLaysOutTheBrowsersTank() {
        XCTAssertEqual(Self.golden.count, 5)
        for g in Self.golden {
            let f = field(g)
            let name = "seed \(g.seed) \(g.mix)"
            XCTAssertEqual(f.fish.count, g.fish.count, "fish count, \(name)")
            for (a, b) in zip(f.fish, g.fish) {
                let breed: String = switch a.breed { case .beta: "beta"; case .angel: "angel"; case .seahorse: "seahorse"; case .turtle: "turtle" }
                XCTAssertEqual(breed, b.breed, name)
                close(a.depth, b.depth, name); close(a.lane, b.lane, name); close(a.period, b.period, name)
                close(a.phase, b.phase, name); close(a.dir, b.dir, name); close(a.bobAmp, b.bobAmp, name)
                close(a.bobHz, b.bobHz, name); close(a.bobPhase, b.bobPhase, name)
            }
            XCTAssertEqual(f.kelp.count, g.kelp.count)
            for (a, b) in zip(f.kelp, g.kelp) { close(a.x, b.x, name); close(a.height, b.height, name); close(a.width, b.width, name); close(a.swayPhase, b.swayPhase, name) }
            for (a, b) in zip(f.bubbles, g.bubbles) { close(a.x, b.x, name); close(a.period, b.period, name); close(a.phase, b.phase, name); close(a.drift, b.drift, name) }
            XCTAssertEqual(f.flora, g.flora, name)
            XCTAssertEqual(f.palette.shaftAlpha, g.palette.shaftAlpha, name)

            let e = f.extras
            XCTAssertEqual(e.critters.map(\.breed), g.extras.critters.map(\.breed), name)
            for (a, b) in zip(e.critters, g.extras.critters) {
                close(a.depth, b.depth, name); close(a.lane, b.lane, name); close(a.period, b.period, name)
                close(a.phase, b.phase, name); close(a.dir, b.dir, name); close(a.bobAmp, b.bobAmp, name)
                close(a.bobHz, b.bobHz, name); close(a.bobPhase, b.bobPhase, name)
            }
            XCTAssertEqual(e.snow.count, g.extras.snow.count, name)
            for (a, b) in zip(e.snow, g.extras.snow) { close(a.x, b.x, name); close(a.y, b.y, name); close(a.fall, b.fall, name); close(a.sway, b.sway, name); close(a.r, b.r, name) }
            XCTAssertEqual(e.lanterns.count, g.extras.lanterns.count, name)
            for (a, b) in zip(e.lanterns, g.extras.lanterns) { close(a.x, b.x, name); close(a.y, b.y, name); close(a.drift, b.drift, name); close(a.pulse, b.pulse, name); close(a.r, b.r, name) }
            XCTAssertEqual(e.shoal.count, g.extras.shoal.count, name)
            for (a, b) in zip(e.shoal, g.extras.shoal) { close(a.dx, b.dx, name); close(a.dy, b.dy, name); close(a.wiggle, b.wiggle, name) }
            close(e.shoalLane, g.extras.shoalLane, name)

            for pose in g.poses {
                for (c, want) in zip(e.critters, pose.critters) {
                    let p = AquariumExtras.pose(c, t: pose.t, w: 1920, h: 1080)
                    close(p.x, want.x, "critter x \(name) t=\(pose.t)"); close(p.y, want.y, "critter y \(name)")
                    close(p.side, want.side, name); close(p.alpha, want.alpha, name)
                }
                for (m, want) in zip(e.snow, pose.snow) {
                    let p = AquariumExtras.motePos(m, t: pose.t, w: 1920, h: 1080)
                    close(p.x, want.x, name); close(p.y, want.y, name)
                }
                for (l, want) in zip(e.lanterns, pose.lanterns) {
                    let p = AquariumExtras.lanternPos(l, t: pose.t, w: 1920, h: 1080)
                    close(p.x, want.x, name); close(p.y, want.y, name); close(p.glow, want.glow, name)
                }
                let c = AquariumExtras.shoalCentre(lane: e.shoalLane, speed: f.shoalSpeed, t: pose.t, w: 1920, h: 1080)
                close(c.x, pose.shoal.x, name); close(c.y, pose.shoal.y, name)
            }
        }
    }

    func testTheRoomOverridesMatchTheBrowser() {
        for g in Self.golden {
            let f = field(g)
            let env = EnvironmentValues()
            func same(_ c: Color, _ rgb: Golden.RGB, _ what: String) {
                let want = Color(red: rgb.r, green: rgb.g, blue: rgb.b).resolve(in: env)
                let got = c.resolve(in: env)
                XCTAssertEqual(got.red, want.red, accuracy: 1e-5, what)
                XCTAssertEqual(got.green, want.green, accuracy: 1e-5, what)
                XCTAssertEqual(got.blue, want.blue, accuracy: 1e-5, what)
            }
            same(f.palette.top, g.palette.top, "top \(g.seed)")
            same(f.palette.mid, g.palette.mid, "mid \(g.seed)")
            same(f.palette.deep, g.palette.deep, "deep \(g.seed)")
            same(f.palette.kelp, g.palette.kelp, "kelp \(g.seed)")
            same(f.palette.dune, g.palette.dune, "dune \(g.seed)")
        }
    }

    func testAnUnmintedMixCastsCrittersNotARandomCast() {
        let f = AquariumField(seed: 7, tier: .t3, environment: "reef", fishMix: "dot:1,dolphin:1,babyfish:3")
        XCTAssertTrue(f.fish.isEmpty)
        XCTAssertEqual(f.extras.critters.map(\.breed), ["dot", "dolphin", "babyfish", "babyfish", "babyfish"])
        for name in CritterBreed.all.values.map(\.asset) {
            XCTAssertNotNil(UIImage(named: name), "\(name) is bundled")
        }
    }
}
