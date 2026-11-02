import XCTest
@testable import IdleScreensTV

/// The 3D tank's swim route against packages/saver-metaquarium `plan.ts`:
/// `createRng(seed).fork(0x715).fork(i)` → `compileSwimPlan` → `swimPoseAt`,
/// every shape, three seeds, five times (Fixtures/swim-golden.json).
final class SwimPlanTests: XCTestCase {
    private struct Golden: Decodable {
        struct P: Decodable { var x, y, z, fx, fy, fz, roll, dist: Double }
        var seed: UInt32; var shape: String; var i: Int; var n: Int
        var total: Double; var cruise: Double; var poses: [P]
    }

    private static let times = [0, 1.5, 30, 123.4, 1000.0]

    func testSwimRoutesMatchTheWebTank() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "swim-golden", withExtension: "json"))
        let goldens = try JSONDecoder().decode([Golden].self, from: Data(contentsOf: url))
        XCTAssertEqual(goldens.count, 54)
        for g in goldens {
            let shape = try XCTUnwrap(SwimPlan.Shape(rawValue: g.shape))
            let plan = SwimPlan(rng: TankRng(seed: g.seed).fork(0x715).fork(g.i), shape: shape, cameraAzimuthDeg: 35)
            let tag = "\(g.seed)/\(g.shape)/\(g.i)"
            XCTAssertEqual(plan.points.count, g.n, tag)
            XCTAssertEqual(plan.cruise, g.cruise, accuracy: 1e-12, tag)
            XCTAssertEqual(plan.totalLength, g.total, accuracy: 1e-9, tag)
            for (t, want) in zip(Self.times, g.poses) {
                let got = plan.pose(at: t)
                for (a, b, name) in [(got.x, want.x, "x"), (got.y, want.y, "y"), (got.z, want.z, "z"),
                                     (got.fx, want.fx, "fx"), (got.fy, want.fy, "fy"), (got.fz, want.fz, "fz"),
                                     (got.roll, want.roll, "roll")] {
                    XCTAssertEqual(a, b, accuracy: 1e-6, "\(tag) t=\(t) \(name)")
                }
            }
        }
    }
}
