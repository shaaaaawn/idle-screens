import XCTest
@testable import IdleScreens

/// A pairing code is read off a TV across a room and typed on a phone, so
/// every forgiving thing the field can do saves a failed round trip that
/// reports "check the code" — the one message guaranteed to send the user
/// hunting for a typo that isn't there.
final class PairCodeFormatTests: XCTestCase {
    func testPlainCodePassesThrough() {
        XCTAssertEqual(PairCodeFormat.normalize("K7M2PW"), "K7M2PW")
    }

    func testLowercaseAndSpacingAreForgiven() {
        XCTAssertEqual(PairCodeFormat.normalize("k7m 2pw"), "K7M2PW")
        XCTAssertEqual(PairCodeFormat.normalize(" K7M-2PW "), "K7M2PW")
    }

    /// The regression this file exists for. The Mac host displays the pairing
    /// URL and the TV's QR encodes it, so pasting one into the code field is
    /// an obvious thing to do. Stripping punctuation FIRST turned it into
    /// HTTPSIDLESCREENSCOMPAIRK7M2PW and the server rejected it.
    func testPastedPairingURLYieldsTheCodeNotTheWholeURL() {
        XCTAssertEqual(
            PairCodeFormat.normalize("https://idlescreens.com/pair/K7M2PW"), "K7M2PW")
        XCTAssertEqual(PairCodeFormat.normalize("idlescreens://pair/K7M2PW"), "K7M2PW")
    }

    func testOverlongInputIsCappedAtTheCodeLength() {
        XCTAssertEqual(PairCodeFormat.normalize("K7M2PWEXTRA"), "K7M2PW")
    }

    func testGarbageYieldsNil() {
        XCTAssertNil(PairCodeFormat.normalize(""))
        XCTAssertNil(PairCodeFormat.normalize("   "))
        XCTAssertNil(PairCodeFormat.normalize("0110"), "excluded characters only")
    }

    /// The server mints from a no-lookalike alphabet, so any of these being
    /// typed is a misread rather than a code — worth naming, not eating.
    func testExcludedLookalikesAreRejectedNotSilentlyDropped() {
        for character in ["0", "O", "1", "I", "L"] {
            XCTAssertFalse(PairCodeFormat.alphabet.contains(character),
                           "\(character) must stay out of the alphabet")
            XCTAssertNotNil(PairCodeFormat.rejectedCharacter(in: "K7\(character)"),
                            "\(character) should be reported to the user")
        }
    }

    /// The server dropped BOTH members of each lookalike pair, so a hint that
    /// says "you typed O, try 0" sends the user to a character that is equally
    /// invalid. A hint must never name a character the code can't contain.
    func testHintNeverRecommendsACharacterThatIsAlsoExcluded() {
        for character: Character in ["0", "O", "1", "I", "L"] {
            let hint = PairCodeFormat.hint(for: character)
            XCTAssertFalse(hint.lowercased().contains("try "),
                           "hint for \(character) suggests a substitute: \(hint)")
            XCTAssertTrue(hint.contains(String(character)),
                          "hint for \(character) should name it: \(hint)")
        }
    }

    func testCompletenessGatesTheSubmitButton() {
        XCTAssertFalse(PairCodeFormat.isComplete("K7M2P"))
        XCTAssertTrue(PairCodeFormat.isComplete("K7M2PW"))
    }

    func testFilterInputClearsToEmptyRatherThanNil() {
        XCTAssertEqual(PairCodeFormat.filterInput(""), "")
        XCTAssertEqual(PairCodeFormat.filterInput("k7m"), "K7M")
        XCTAssertEqual(PairCodeFormat.filterInput("https://idlescreens.com/pair/K7M2PW"),
                       "K7M2PW")
    }
}
