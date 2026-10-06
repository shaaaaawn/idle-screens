import XCTest
@testable import IdleScreensTV

/// `motion.center` is a union — `{x, y}` OR `{layer}` (compound creatures).
/// Decoding it as a strict point made one parented layer fail, which failed
/// the layer, which failed the ENTIRE spec, which dropped the whole channel
/// to the "live view isn't available on this TV" fallback.
final class OrbitParentTests: XCTestCase {

    private func compile(_ json: String) throws -> [CompiledLayer] {
        let spec = try JSONDecoder().decode(SpecSubset.self, from: Data(json.utf8))
        return spec.compile(seed: spec.seed ?? 1)
    }

    func testParentedOrbitDoesNotFailTheWholeSpec() throws {
        let layers = try compile(##"""
        {"seed":6,"layers":[
          {"key":"bell","count":1,"sprite":{"kind":"circle","radius":[0.05,0.05],"color":"#fff"},
           "motion":{"type":"drift","speed":[0.01,0.01],"angle":0}},
          {"key":"tentacle","count":1,"sprite":{"kind":"stroke","length":[0.1,0.1],
             "points":[[0,-1],[0,1]],"color":"#0ff"},
           "motion":{"type":"orbit","speed":[0,0],"radius":[0.01,0.01],
                     "center":{"layer":"bell"}}}]}
        """##)
        XCTAssertEqual(layers.count, 2, "a parented layer killed the spec")
        XCTAssertEqual(layers[0].key, "bell")
        XCTAssertEqual(layers[1].orbitParentKey, "bell")
        let child = layers[1].entities[0]
        XCTAssertTrue(child.orbitParented)
        // A parented child orbits (0,0): its position is an OFFSET.
        XCTAssertEqual(child.orbitCx, 0)
        XCTAssertEqual(child.orbitCy, 0)
    }

    func testParentedChildRidesItsParent() throws {
        let layers = try compile(##"""
        {"seed":6,"layers":[
          {"key":"bell","count":1,"sprite":{"kind":"circle","radius":[0.05,0.05],"color":"#fff"},
           "motion":{"type":"static"},"position":{"x":0.25,"y":0.5}},
          {"key":"tentacle","count":1,"sprite":{"kind":"circle","radius":[0.01,0.01],"color":"#0ff"},
           "motion":{"type":"orbit","speed":[0,0],"radius":[0,0],"center":{"layer":"bell"}}}]}
        """##)
        let size = CGSize(width: 1000, height: 1000)
        let parent = layers[0].entities[0]
        let child = layers[1].entities[0]
        // Radius 0: the child sits exactly ON the parent.
        let p = SceneMotion.position(of: child, at: 0, in: size, dim: 1000,
                                     wrap: false, parent: parent)
        XCTAssertEqual(p.x, 250, accuracy: 1e-6)
        XCTAssertEqual(p.y, 500, accuracy: 1e-6)
        // Without the parent it collapses to the origin — the detached-limb
        // look this linkage exists to prevent.
        let orphan = SceneMotion.position(of: child, at: 0, in: size, dim: 1000, wrap: false)
        XCTAssertEqual(orphan.x, 0, accuracy: 1e-6)
    }

    func testPointCentredOrbitStillWorks() throws {
        let layers = try compile(##"""
        {"seed":6,"layers":[{"count":1,"sprite":{"kind":"circle","radius":[0.01,0.01],"color":"#fff"},
          "motion":{"type":"orbit","speed":[10,10],"radius":[0.2,0.2],"center":{"x":0.3,"y":0.7}}}]}
        """##)
        let e = layers[0].entities[0]
        XCTAssertFalse(e.orbitParented)
        XCTAssertEqual(e.orbitCx, 0.3)
        XCTAssertEqual(e.orbitCy, 0.7)
    }
}
