import XCTest
@testable import IdleScreens

/// Guards a structural invariant that a compiler and a normal test suite are
/// both blind to.
///
/// SwiftUI presents **one sheet per presentation anchor**. `PairedTVView` shows
/// "Add a screen" as a sheet, and the scanner as a second sheet. When both hung
/// off the same view, tapping *Scan QR* inside the Add sheet set a flag that
/// presented nothing — no scanner, no error, no log. The empty-state hero button
/// still worked (nothing was presented at that moment), so the failure only
/// appeared on the path you take *after* pairing your first screen — which from
/// then on is the only path there is. QR scanning was dead for returning users.
///
/// It was fixed once, then silently reverted by a release merge: the commit went
/// unreachable and the file came back without it. A build passed. Forty-one
/// tests passed. Nothing said a word. Hence this test — it is deliberately a
/// source-text assertion, because the bug lives in view *structure*, which
/// neither the type system nor a runtime unit test can reach.
final class PairingSheetAnchorTests: XCTestCase {
    private var source: String {
        get throws {
            // #filePath points into the checkout, so the sibling source is
            // reachable without bundling it as a test resource.
            let testFile = URL(fileURLWithPath: #filePath)
            let root = testFile
                .deletingLastPathComponent()   // IdleScreensTests
                .deletingLastPathComponent()   // ios
            let target = root
                .appendingPathComponent("IdleScreens/Pair/PairedTVView.swift")
            return try String(contentsOf: target, encoding: .utf8)
        }
    }

    /// The Add sheet must own a scanner binding distinct from the root's.
    func testAddSheetPresentsTheScannerFromItsOwnAnchor() throws {
        let source = try source
        XCTAssertTrue(
            source.contains("showingScannerInSheet"),
            """
            PairedTVView no longer has a separate scanner binding for the \
            "Add a screen" sheet. Two `.sheet` modifiers on the same view share \
            one presentation anchor, so Scan QR inside that sheet will silently \
            present nothing — and that is the only path to scanning once the \
            user has paired a screen. This regressed once via a release merge; \
            check the merge resolution of PairedTVView.swift.
            """
        )
    }

    /// The shared form must be told which anchor it is rendering into, rather
    /// than closing over one binding that is right for only one of its callers.
    func testPairingFormTakesTheScanBindingFromItsCaller() throws {
        let source = try source
        XCTAssertTrue(
            source.contains("pairingForm(scanBinding:"),
            """
            pairingForm no longer takes its scan binding as a parameter. It is \
            shared by the empty state (root anchor) and the Add sheet (sheet \
            anchor); a single fixed binding works for exactly one of them and \
            fails silently for the other.
            """
        )
        // Both call sites must pass one — a default argument would reintroduce
        // the single-binding bug while still satisfying the check above.
        XCTAssertTrue(source.contains("pairingForm(scanBinding: $showingScannerInSheet)"))
        XCTAssertTrue(source.contains("pairingForm(scanBinding: $showingScanner)"))
    }
}
