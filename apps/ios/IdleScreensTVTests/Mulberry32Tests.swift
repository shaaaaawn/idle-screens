import XCTest
@testable import IdleScreensTV

final class Mulberry32Tests: XCTestCase {
    func testSameSeedSameSequence() {
        var a = Mulberry32(seed: 42)
        var b = Mulberry32(seed: 42)
        for _ in 0..<100 {
            XCTAssertEqual(a.next(), b.next())
        }
    }

    func testDifferentSeedsDiffer() {
        var a = Mulberry32(seed: 1)
        var b = Mulberry32(seed: 2)
        let seqA = (0..<10).map { _ in a.next() }
        let seqB = (0..<10).map { _ in b.next() }
        XCTAssertNotEqual(seqA, seqB)
    }

    func testOutputsInUnitRange() {
        var rng = Mulberry32(seed: 7)
        for _ in 0..<1000 {
            let v = rng.next()
            XCTAssertGreaterThanOrEqual(v, 0)
            XCTAssertLessThan(v, 1)
        }
    }

    func testCompileIsDeterministic() throws {
        let spec = try SpecSubsetTests.decode(SpecSubsetTests.snowfallJSON)
        let first = spec.compile(seed: 12)
        let second = spec.compile(seed: 12)
        XCTAssertEqual(first, second)
        XCTAssertEqual(first.count, 3)
        XCTAssertEqual(first[0].entities.count, 50)
    }
}
