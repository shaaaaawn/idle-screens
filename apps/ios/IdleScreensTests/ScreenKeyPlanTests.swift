import XCTest
@testable import IdleScreens

/// What a push owes a paired screen when the channel is private
/// (`AppState.screenKeyPlan`; idle-server capability-auth.md "Native screens").
final class ScreenKeyPlanTests: XCTestCase {
    private func plan(_ kind: PairedScreen.Kind, private isPrivate: Bool = true,
                      held: ChannelRole? = .viewer, publicKey: Bool = true) -> AppState.ScreenKeyPlan {
        AppState.screenKeyPlan(kind: kind, isPrivate: isPrivate, held: held, hasPublicKey: publicKey)
    }

    func testATVGetsAViewerKeySealed() {
        XCTAssertEqual(plan(.appleTV, held: .viewer), .send(.viewer))
        XCTAssertEqual(plan(.appleTV, held: .owner), .send(.owner), "an owner mints a viewer key for the TV")
    }

    func testAMacOrLinuxScreenIsNeverSentOne() {
        // They hold their own key (Keychain / key file) and never give a
        // public key: a private push to them must still go through.
        for kind in [PairedScreen.Kind.mac, .linux] {
            XCTAssertEqual(plan(kind, publicKey: false), .skip, "\(kind)")
            XCTAssertEqual(plan(kind, held: .owner, publicKey: false), .skip, "\(kind)")
        }
    }

    func testNothingRidesAPublicChannelOrAPushWithoutAKey() {
        XCTAssertEqual(plan(.appleTV, private: false), .skip)
        XCTAssertEqual(plan(.appleTV, held: nil), .skip)
    }

    func testAnEditorKeyIsNeverSentAndAnOldPairingIsToldToRepair() {
        XCTAssertEqual(plan(.appleTV, held: .editor), .editorKey)
        XCTAssertEqual(plan(.appleTV, held: .viewer, publicKey: false), .needsRepair)
    }
}
