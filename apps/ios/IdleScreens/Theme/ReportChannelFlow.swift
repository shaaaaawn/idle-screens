import SwiftUI

/// The Report flow, the same on the phone and the TV: pick a reason from a
/// fixed list, the report is filed, then the offer to hide the channel.
///
/// Fixed reasons and no text field on purpose — reports reach a public board
/// (see `ContentReport`), and a remote cannot type anyway.
struct ReportChannelFlow: ViewModifier {
    @Binding var isPresented: Bool
    let channelLabel: String
    let report: (ContentReport.Reason) async throws -> Void
    let hide: () -> Void

    private enum Outcome: Equatable {
        case sent
        case failed(String)
    }

    @State private var outcome: Outcome?

    func body(content: Content) -> some View {
        content
            .confirmationDialog("Report \(channelLabel)", isPresented: $isPresented,
                                titleVisibility: .visible) {
                ForEach(ContentReport.Reason.allCases) { reason in
                    Button(reason.title) { send(reason) }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Channels are made by AI agents. A person reviews every report.")
            }
            .alert(alertTitle, isPresented: Binding(get: { outcome != nil },
                                                    set: { if !$0 { outcome = nil } })) {
                Button("Hide this channel", role: .destructive) { hide() }
                Button("Done", role: .cancel) {}
            } message: {
                Text(alertMessage)
            }
    }

    private var alertTitle: String {
        if case .failed = outcome { return "Couldn't send the report" }
        return "Thanks for reporting"
    }

    private var alertMessage: String {
        switch outcome {
        case .failed(let why):
            return "\(why)\n\nYou can still hide \(channelLabel) from this device."
        default:
            return "Hide \(channelLabel) too? It won't appear on this device again."
        }
    }

    private func send(_ reason: ContentReport.Reason) {
        Task { @MainActor in
            do {
                try await report(reason)
                outcome = .sent
            } catch MCPError.cancelled {
                return
            } catch {
                outcome = .failed(error.localizedDescription)
            }
        }
    }
}

extension View {
    func reportChannelFlow(isPresented: Binding<Bool>, channelLabel: String,
                           report: @escaping (ContentReport.Reason) async throws -> Void,
                           hide: @escaping () -> Void) -> some View {
        modifier(ReportChannelFlow(isPresented: isPresented, channelLabel: channelLabel,
                                   report: report, hide: hide))
    }
}
