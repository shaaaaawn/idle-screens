import XCTest

/// App Store processing rejects a build whose App Intents text names an Apple
/// product (ITMS-90626 "Invalid Siri Support": build 2026111701 was refused
/// for "Shows a channel on your paired Apple TV, Mac or Linux screens.").
/// `altool --validate-app` does not check this — the rejection arrives by
/// email after upload — so this reads the metadata the compiler extracted
/// into the app and the widgets extension, exactly what Apple scans, and runs
/// in `make app ios ship`'s gate before anything is archived.
final class AppIntentsMetadataTests: XCTestCase {
    /// Apple trademarks that intent titles, descriptions, parameters and
    /// phrases may not contain, matched as whole words. Apple named "apple"
    /// and "mac" in the rejection; the rest are the same rule applied before
    /// Apple has to tell us. ("TV" alone passed.)
    static let reserved = [
        "apple", "mac", "macos", "macbook", "imac", "iphone", "ipad", "ipados", "ipod",
        "siri", "ios", "tvos", "watchos", "visionos", "airpods", "airplay", "homepod",
        "carplay", "facetime", "icloud",
    ]

    static func reservedWords(in text: String) -> [String] {
        // System identifiers ("com.apple.link.systemProtocol.…") are not
        // display text; a dotted token with no spaces is one.
        if !text.contains(" "), text.contains("."), text.wholeMatch(of: /[A-Za-z0-9_.-]+/) != nil { return [] }
        let words = Set(text.lowercased().split { !$0.isLetter }.map(String.init))
        return reserved.filter(words.contains)
    }

    func testTheMatcherCatchesTheRejectedDescription() {
        XCTAssertEqual(Self.reservedWords(in: "Shows a channel on your paired Apple TV, Mac or Linux screens."),
                       ["apple", "mac"])
        XCTAssertEqual(Self.reservedWords(in: "Shows a channel on your paired screens."), [])
        XCTAssertEqual(Self.reservedWords(in: "Machine room"), [], "whole words only")
        XCTAssertEqual(Self.reservedWords(in: "Mac"), ["mac"], "a one-word title still counts")
        XCTAssertEqual(Self.reservedWords(in: "com.apple.link.systemProtocol.WidgetConfiguration"), [])
    }

    func testNoIntentTextNamesAnApplePlatform() throws {
        let app = Bundle.main.bundleURL
        let plugins = try XCTUnwrap(Bundle.main.builtInPlugInsURL)
        let files = [
            app.appending(path: "Metadata.appintents/extract.actionsdata"),
            plugins.appending(path: "IdleScreensWidgets.appex/Metadata.appintents/extract.actionsdata"),
        ]
        var offenders: [String] = []
        for file in files {
            // A missing file must fail, not pass: no metadata means no check.
            let data = try Data(contentsOf: file)
            let json = try JSONSerialization.jsonObject(with: data)
            Self.strings(in: json).forEach { text in
                let hits = Self.reservedWords(in: text)
                if !hits.isEmpty {
                    offenders.append("\(file.deletingLastPathComponent().deletingLastPathComponent().lastPathComponent): \"\(text)\" names \(hits)")
                }
            }
        }
        XCTAssertTrue(offenders.isEmpty, "App Store will reject (ITMS-90626):\n" + offenders.joined(separator: "\n"))
    }

    private static func strings(in value: Any) -> [String] {
        switch value {
        case let s as String: [s]
        case let a as [Any]: a.flatMap(strings(in:))
        case let d as [String: Any]: d.values.flatMap(strings(in:))
        default: []
        }
    }
}
