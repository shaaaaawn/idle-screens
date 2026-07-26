import XCTest
@testable import IdleScreensTV

final class CapabilityTierTests: XCTestCase {
    func testA8AndA10XAreT2() {
        // Pre-A12 boxes get the GPU sprite renderer, never the CPU canvas.
        XCTAssertEqual(CapabilityDetector.tier(forMachine: "AppleTV5,3"), .t2)
        XCTAssertEqual(CapabilityDetector.tier(forMachine: "AppleTV6,2"), .t2)
    }

    func testA12AndLaterAreT3() {
        XCTAssertEqual(CapabilityDetector.tier(forMachine: "AppleTV11,1"), .t3)
        XCTAssertEqual(CapabilityDetector.tier(forMachine: "AppleTV14,1"), .t3)
        XCTAssertEqual(CapabilityDetector.tier(forMachine: "AppleTV15,1"), .t3)
    }

    func testSimulatorIsT3() {
        XCTAssertEqual(CapabilityDetector.tier(forMachine: "arm64"), .t3)
        XCTAssertEqual(CapabilityDetector.tier(forMachine: "x86_64"), .t3)
    }

    func testUnknownHardwareDefaultsToT2() {
        XCTAssertEqual(CapabilityDetector.tier(forMachine: "SomethingElse1,1"), .t2)
    }

    func testDowngradeSteps() {
        XCTAssertEqual(CapabilityTier.t3.downgraded(), .t2)
        XCTAssertEqual(CapabilityTier.t2.downgraded(), .t1)
        XCTAssertEqual(CapabilityTier.t1.downgraded(), .t0)
        XCTAssertEqual(CapabilityTier.t0.downgraded(), .t0)
    }
}
