import SwiftUI
import UIKit

/// Six-character pairing code entry.
///
/// Reads as a code, not a text box: one cell per character, so the user can
/// see at a glance how many are left and check what they typed against the
/// screen across the room without re-reading a run-on string. Filtering
/// happens per keystroke — an impossible character is named rather than
/// silently eaten, and a pasted pairing URL collapses to just its code.
struct PairCodeField: View {
    @Binding var code: String
    var isBusy = false
    /// Fired when six valid characters are in — pairing shouldn't need a
    /// separate "go" tap once the code can't get any more complete.
    var onComplete: (String) -> Void

    @FocusState private var focused: Bool
    @State private var rejected: String?
    /// The value this view wrote to `code` itself, so the resulting onChange
    /// can be told apart from a real keystroke.
    @State private var echo: String?

    private var characters: [Character] { Array(code) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ZStack {
                // The real field, invisible: it owns the keyboard and paste
                // menu while the cells own the appearance.
                TextField("", text: $code)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .keyboardType(.asciiCapable)
                    .textContentType(.oneTimeCode)
                    .focused($focused)
                    .opacity(0.001)
                    .onChange(of: code) { old, new in
                        apply(new, previous: old)
                    }
                    .onSubmit { submitIfComplete() }

                cells
            }
            .frame(height: 58)

            if let rejected {
                label(rejected, icon: "exclamationmark.circle.fill", tint: Color.textSecondary)
            } else {
                HStack(spacing: 10) {
                    Text("Six characters, shown on your screen.")
                        .font(.caption)
                        .foregroundStyle(Color.textTertiary)
                    Spacer(minLength: 0)
                    pasteButton
                }
            }
        }
        .onAppear { focused = true }
    }

    private var cells: some View {
        HStack(spacing: 8) {
            ForEach(0..<PairCodeFormat.length, id: \.self) { index in
                cell(at: index)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { focused = true }
    }

    private func cell(at index: Int) -> some View {
        // The "cursor" is the first empty cell — and the last cell once full,
        // so a complete code still looks anchored rather than cursor-less.
        let isCursor = focused && (index == characters.count
            || (characters.count == PairCodeFormat.length && index == PairCodeFormat.length - 1))
        let character = index < characters.count ? String(characters[index]) : ""

        return Text(character)
            .font(.system(size: 24, weight: .semibold, design: .monospaced))
            .foregroundStyle(Color.textPrimary)
            .frame(maxWidth: .infinity)
            .frame(height: 58)
            .background(Color.appSurfaceRaised, in: RoundedRectangle(cornerRadius: 12))
            .overlay {
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(isCursor ? Color.textPrimary : Color.appBorder.opacity(0.6),
                                  lineWidth: isCursor ? 2 : 1)
            }
            .animation(.easeOut(duration: 0.15), value: isCursor)
            .animation(.easeOut(duration: 0.15), value: character)
    }

    @ViewBuilder
    private var pasteButton: some View {
        // `hasStrings` is the only pasteboard query that does NOT trigger the
        // system "would like to paste" alert. Reading `.string` here to decide
        // whether to show the button prompts the user the instant the sheet
        // appears, for a paste they never asked for — so the content is only
        // read inside the tap handler, where the prompt is expected.
        if UIPasteboard.general.hasStrings {
            Button {
                paste()
            } label: {
                Label("Paste", systemImage: "doc.on.clipboard")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.textPrimary)
            }
        }
    }

    private func paste() {
        guard let pasted = UIPasteboard.general.string else { return }
        guard let candidate = PairCodeFormat.normalize(pasted) else {
            rejected = "That clipboard text isn't a pairing code."
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
            return
        }
        rejected = nil
        code = candidate
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        submitIfComplete()
    }

    private func label(_ text: String, icon: String, tint: Color) -> some View {
        Label(text, systemImage: icon)
            .font(.caption)
            .foregroundStyle(tint)
    }

    /// Normalise each keystroke, and explain the ones we drop.
    private func apply(_ new: String, previous: String) {
        // Writing `code` from inside this handler re-enters it. Without
        // recognising our own write, the echo immediately clears the very
        // message the rejection just set, and the user sees their character
        // silently vanish with no explanation.
        if let echo, echo == new {
            self.echo = nil
            return
        }

        let filtered = PairCodeFormat.filterInput(new)
        if filtered != new {
            // Only complain about a genuinely impossible character; ordinary
            // over-typing past six shouldn't produce a scolding message.
            if let bad = PairCodeFormat.rejectedCharacter(in: new) {
                rejected = PairCodeFormat.hint(for: bad)
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
            }
            echo = filtered
            code = filtered
            return
        }
        rejected = nil
        if filtered.count == PairCodeFormat.length && previous.count < filtered.count {
            submitIfComplete()
        }
    }

    private func submitIfComplete() {
        guard PairCodeFormat.isComplete(code), !isBusy else { return }
        focused = false
        onComplete(code)
    }
}
