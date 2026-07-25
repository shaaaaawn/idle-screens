import SwiftUI

/// t0 renderer — the guaranteed floor. Calls the `previewScene` MCP tool with
/// the current spec and renders the returned 40×12 braille luminance map.
struct PerceptionView: View {
    let specJSON: JSONValue?
    let backgroundColor: String?
    @Environment(TVAppState.self) private var app

    @State private var braille = ""

    var body: some View {
        ZStack {
            (backgroundColor.map { Color(hex: $0) } ?? Color.black)
                .ignoresSafeArea()
            Text(braille)
                .font(.system(size: 32, design: .monospaced))
                .tracking(10)
                .multilineTextAlignment(.center)
                .foregroundStyle(.white.opacity(0.85))
                .padding(40)
        }
        .ignoresSafeArea()
        .task { await poll() }
    }

    private func poll() async {
        guard let specJSON else { return }
        while !Task.isCancelled {
            do {
                let text = try await app.mcp.callTool("previewScene", arguments: [
                    "spec": specJSON,
                    "width": .int(960),
                    "height": .int(540),
                    "t": .int(5),
                ])
                if let data = text.data(using: .utf8),
                   let result = try? JSONDecoder().decode([String: JSONValue].self, from: data),
                   case .string(let map)? = result["braille"] {
                    braille = map
                }
            } catch {
                // Keep showing the last good frame.
            }
            try? await Task.sleep(for: .seconds(5))
        }
    }
}
