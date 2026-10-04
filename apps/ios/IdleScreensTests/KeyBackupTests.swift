import XCTest
@testable import IdleScreens

final class KeyBackupTests: XCTestCase {
    private let date = Date(timeIntervalSince1970: 1_790_000_000)

    func testEveryKeyIsWrittenAsARestorableLink() throws {
        let doc = KeyBackup.document([
            .init(channelId: "living-room", label: "Living Room", role: "owner", token: "isk_own_abc"),
            .init(channelId: "attic", label: "attic", role: nil, token: "isk_xyz"),
        ], generatedAt: date)
        XCTAssertTrue(doc.contains("2 keys"))
        XCTAssertTrue(doc.contains("KEEP THIS PRIVATE"))
        XCTAssertTrue(doc.contains("Living Room (owner)"))
        // Each restore line is exactly the handoff link the app already parses.
        for (id, token) in [("living-room", "isk_own_abc"), ("attic", "isk_xyz")] {
            let line = try XCTUnwrap(doc.split(separator: "\n").first { $0.contains("restore:") && $0.contains(id) })
            let link = try XCTUnwrap(URL(string: String(line.split(separator: " ").last!)))
            let parsed = try XCTUnwrap(ChannelTokenFormat.handoff(from: link))
            XCTAssertEqual(parsed.channelId, id)
            XCTAssertEqual(parsed.token, token)
        }
        // Sorted by name, case-insensitively.
        XCTAssertLessThan(try XCTUnwrap(doc.range(of: "attic")).lowerBound, try XCTUnwrap(doc.range(of: "Living Room")).lowerBound)
    }

    func testFileNameIsDated() {
        XCTAssertTrue(KeyBackup.fileName(at: date).hasPrefix("idle-screens-keys-"))
        XCTAssertTrue(KeyBackup.fileName(at: date).hasSuffix(".txt"))
    }
}
