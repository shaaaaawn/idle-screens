import SwiftUI

/// Light, dark, or whatever the phone is set to — for the app's chrome only.
/// The Watch feed is a screen showing artwork and always plays dark, as the
/// TV app does.
enum Appearance: String, CaseIterable, Identifiable {
    case system, light, dark

    static let storageKey = "appearance"
    /// Dark until someone picks otherwise: the app is a frame around
    /// artwork, and a light frame fights it.
    static let defaultValue: Appearance = .dark

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: "Automatic"
        case .light: "Light"
        case .dark: "Dark"
        }
    }

    /// nil hands the choice back to the system.
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

/// Three little screens to tap, the way iOS's own Display settings offers it.
struct AppearancePicker: View {
    @Binding var selection: Appearance
    @Environment(\.deviceScale) private var scale

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Appearance.allCases) { option in
                Button {
                    withAnimation(.snappy) { selection = option }
                    UISelectionFeedbackGenerator().selectionChanged()
                } label: {
                    VStack(spacing: 10) {
                        Thumb(option: option)
                            .frame(width: 56 * scale, height: 98 * scale)
                            .overlay {
                                RoundedRectangle(cornerRadius: 12 * scale)
                                    .strokeBorder(selection == option ? Color.appPrimary : Color.appBorder,
                                                  lineWidth: selection == option ? 2.5 : 1)
                            }
                        Text(option.label)
                            .font(.subheadline)
                            .foregroundStyle(Color.textPrimary)
                        Image(systemName: selection == option ? "checkmark.circle.fill" : "circle")
                            .font(.title3)
                            .foregroundStyle(selection == option ? Color.appPrimary : Color.textTertiary)
                    }
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(option.label)
                .accessibilityAddTraits(selection == option ? .isSelected : [])
            }
        }
        .padding(.vertical, 8)
    }

    private struct Thumb: View {
        let option: Appearance
        @Environment(\.deviceScale) private var scale

        var body: some View {
            ZStack {
                switch option {
                case .light: screen(dark: false)
                case .dark: screen(dark: true)
                case .system:
                    screen(dark: false)
                    screen(dark: true)
                        .mask(alignment: .trailing) { Rectangle().frame(width: 28 * scale) }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 12 * scale))
        }

        private func screen(dark: Bool) -> some View {
            let bg = Color(hex: dark ? "0A0A0F" : "F2F2F7")
            let card = Color(hex: dark ? "1D1D28" : "FFFFFF")
            return ZStack(alignment: .top) {
                bg
                VStack(spacing: 5 * scale) {
                    LinearGradient(colors: [Color(hex: "8B7CFF"), Color(hex: "5EEAD4")],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
                        .frame(height: 26 * scale)
                        .clipShape(RoundedRectangle(cornerRadius: 4 * scale))
                    ForEach(0..<3, id: \.self) { _ in
                        card.frame(height: 9 * scale).clipShape(RoundedRectangle(cornerRadius: 2.5 * scale))
                    }
                }
                .padding(7 * scale)
            }
        }
    }
}
