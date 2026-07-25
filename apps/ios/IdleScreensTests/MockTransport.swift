import Foundation
@testable import IdleScreens

/// Mock HTTPTransport that records requests and serves canned responses.
final class MockTransport: HTTPTransport, @unchecked Sendable {
    var handler: @Sendable (URLRequest) throws -> (Data, Int) = { _ in (Data(), 200) }
    private(set) var requests: [URLRequest] = []

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        let (data, status) = try handler(request)
        let response = HTTPURLResponse(
            url: request.url ?? URL(string: "https://example.com")!,
            statusCode: status,
            httpVersion: nil,
            headerFields: nil
        )!
        return (data, response)
    }

    /// Wrap a tool result payload in the MCP JSON-RPC envelope.
    static func mcpEnvelope(resultText: String, isError: Bool = false) -> Data {
        let escaped = resultText
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        let json = """
        {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"\(escaped)"}],"isError":\(isError)}}
        """
        return Data(json.utf8)
    }
}
