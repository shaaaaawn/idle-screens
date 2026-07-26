import XCTest
@testable import IdleScreens

final class MCPClientTests: XCTestCase {
    private let baseURL = URL(string: "https://example.com")!

    private func makeClient(handler: @escaping @Sendable (URLRequest) throws -> (Data, Int)) -> (MCPClient, MockTransport) {
        let transport = MockTransport()
        transport.handler = handler
        return (MCPClient(baseURL: baseURL, transport: transport), transport)
    }

    func testPublishSceneSuccessParses() async throws {
        let (client, transport) = makeClient { _ in
            (MockTransport.mcpEnvelope(resultText: #"{"ok":true}"#), 200)
        }

        // Should not throw.
        try await client.publishScene(channelId: "test-chan", token: "isk_abc", saverId: "warp", seed: 7)

        XCTAssertEqual(transport.requests.count, 1)
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.url?.path, "/mcp")
        let body = try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any]
        XCTAssertEqual(body?["method"] as? String, "tools/call")
        let params = body?["params"] as? [String: Any]
        XCTAssertEqual(params?["name"] as? String, "publishScene")
        let args = params?["arguments"] as? [String: Any]
        XCTAssertEqual(args?["channelId"] as? String, "test-chan")
        XCTAssertEqual(args?["seed"] as? Int, 7)
        XCTAssertEqual((args?["spec"] as? [String: Any])?["id"] as? String, "warp")
    }

    func testIsErrorThrowsTypedError() async {
        let (client, _) = makeClient { _ in
            (MockTransport.mcpEnvelope(resultText: "bad token", isError: true), 200)
        }

        do {
            try await client.setSeed(channelId: "test-chan", token: "isk_wrong", seed: 1)
            XCTFail("Expected toolError")
        } catch let error as MCPError {
            XCTAssertEqual(error, .toolError(tool: "setSeed", message: "bad token"))
        } catch {
            XCTFail("Wrong error type: \(error)")
        }
    }

    func testNon2xxThrowsHTTPError() async {
        let (client, _) = makeClient { _ in
            (Data("server exploded".utf8), 500)
        }

        do {
            try await client.wake(channelId: "test-chan", token: "isk_abc")
            XCTFail("Expected httpError")
        } catch let error as MCPError {
            XCTAssertEqual(error, .httpError(status: 500, body: "server exploded"))
        } catch {
            XCTFail("Wrong error type: \(error)")
        }
    }

    func testListSaversParsesResultJSON() async throws {
        let (client, _) = makeClient { _ in
            (MockTransport.mcpEnvelope(resultText: #"[{"id":"warp","label":"Warp","description":"starfield"}]"#), 200)
        }

        let savers = try await client.listSavers()
        XCTAssertEqual(savers, [SaverInfo(id: "warp", label: "Warp", description: "starfield")])
    }

    /// The live server returns grouped savers, not a bare array — this shape
    /// regressed silently once (savers list empty forever against prod).
    func testListSaversParsesGroupedResultJSON() async throws {
        let (client, _) = makeClient { _ in
            (MockTransport.mcpEnvelope(resultText:
                #"{"classicSavers":[{"id":"warp","label":"Warp","description":"starfield"}],"note":"ignored"}"#
            ), 200)
        }

        let savers = try await client.listSavers()
        XCTAssertEqual(savers, [SaverInfo(id: "warp", label: "Warp", description: "starfield")])
    }
}
