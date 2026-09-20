import XCTest
@testable import IdleScreens

/// The app is a keyring. There are no accounts on idlescreens.com — a key
/// belongs to a channel, and what you may do there is a property of the key you
/// hold. These tests pin how the app reads that.
final class ChannelRoleTests: XCTestCase {
    /// Prefixes as the server mints them (`idle-server/docs/capability-auth.md`).
    func testThePrefixAdvertisesTheRole() {
        XCTAssertEqual(ChannelRole.hint(fromToken: "isk_5f2a9c"), .owner)
        XCTAssertEqual(ChannelRole.hint(fromToken: "isk_edit_9c1b"), .editor)
        XCTAssertEqual(ChannelRole.hint(fromToken: "isk_view_d94a"), .viewer)
    }

    /// An owner KEY mints channels and steers nothing. Reading it as a channel
    /// owner would light up controls that every call would then refuse.
    func testAnOwnerKeyHoldsNoRoleOnAnyChannel() {
        XCTAssertNil(ChannelRole.hint(fromToken: "isk_own_abc"))
        XCTAssertNil(ChannelRole.hint(fromToken: "isp_screenpair"))
    }

    /// Roles nest downward — never upward.
    func testRolesNestDownward() {
        XCTAssertTrue(ChannelRole.owner.canEdit)
        XCTAssertTrue(ChannelRole.editor.canEdit)
        XCTAssertFalse(ChannelRole.viewer.canEdit, "a viewer key opens a private channel and changes nothing")
        XCTAssertTrue(ChannelRole.owner.canAdminister)
        XCTAssertFalse(ChannelRole.editor.canAdminister, "the server refuses createToken to an editor")
        XCTAssertLessThan(ChannelRole.viewer, .editor)
        XCTAssertLessThan(ChannelRole.editor, .owner)
    }
}

/// Bodies captured from production, 2026-09-19.
final class KeyVerdictTests: XCTestCase {
    private func decode(_ json: String) throws -> KeyVerdict {
        try JSONDecoder().decode(KeyVerdict.self, from: json.data(using: .utf8)!)
    }

    func testEachRoleIsReported() throws {
        XCTAssertEqual(try decode(#"{"valid":true,"protected":true,"role":"owner","access":"public"}"#).role, .owner)
        XCTAssertEqual(try decode(#"{"valid":true,"protected":true,"role":"editor","access":"public"}"#).role, .editor)
        XCTAssertEqual(try decode(#"{"valid":true,"protected":true,"role":"viewer","access":"private"}"#).role, .viewer)
    }

    func testARevokedKeyIsInvalidWithNoRole() throws {
        let verdict = try decode(#"{"valid":false,"protected":true,"role":null,"access":"public"}"#)
        XCTAssertFalse(verdict.valid)
        XCTAssertNil(verdict.role)
    }

    /// Open channels (lobby, default, studio) have no owner: valid, no role.
    func testOpenChannelsAreValidWithoutARole() throws {
        let verdict = try decode(#"{"valid":true,"protected":false,"role":null,"access":"public"}"#)
        XCTAssertTrue(verdict.valid)
        XCTAssertNil(verdict.role)
    }

    /// A role this build has never heard of must not fail the whole verdict —
    /// the key is still valid; we just don't know how far it goes.
    func testAnUnknownRoleDoesNotBreakDecoding() throws {
        let verdict = try decode(#"{"valid":true,"role":"curator"}"#)
        XCTAssertTrue(verdict.valid)
        XCTAssertNil(verdict.role)
    }

    func testOlderServersThatAnswerApproved() throws {
        XCTAssertTrue(try decode(#"{"approved":true}"#).valid)
    }

    func testListTokensRowDecodes() throws {
        let json = #"{"channelId":"c","access":"public","tokens":[{"id":"86aa99da242a","role":"editor","label":"qa-editor","createdAt":1789856980970}],"note":"x"}"#
        let list = try JSONDecoder().decode(KeyGrantList.self, from: json.data(using: .utf8)!)
        XCTAssertEqual(list.tokens.first?.id, "86aa99da242a")
        XCTAssertEqual(list.tokens.first?.role, .editor)
        XCTAssertEqual(list.tokens.first?.label, "qa-editor")
    }

    /// createToken answers with extra fields (`note`, `tokens`, …). Only the id
    /// and the one-time plaintext matter, and extras must not break it.
    func testMintedKeyIgnoresExtraFields() throws {
        let json = #"{"channelId":"c","id":"25f3","role":"editor","label":"pax","token":"isk_edit_9c1b","note":"shown once","tokens":[]}"#
        let key = try JSONDecoder().decode(MintedKey.self, from: json.data(using: .utf8)!)
        XCTAssertEqual(key.id, "25f3")
        XCTAssertEqual(key.token, "isk_edit_9c1b")
    }
}
