import SwiftUI

/// The rounded colour tile iOS's own Settings puts beside a row: one glance
/// finds the row, without reading it.
struct SettingsIcon: View {
    let systemName: String
    let tint: Color
    @Environment(\.deviceScale) private var scale

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 15 * scale, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 29 * scale, height: 29 * scale)
            .background(tint.gradient, in: RoundedRectangle(cornerRadius: 7 * scale, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// A row label: tile, title, optional detail on the right.
struct SettingsLabel: View {
    let title: String
    let icon: String
    let tint: Color
    var detail: String? = nil

    var body: some View {
        LabeledContent {
            if let detail { Text(detail).foregroundStyle(Color.textSecondary) }
        } label: {
            Label {
                Text(title).foregroundStyle(Color.textPrimary)
            } icon: {
                SettingsIcon(systemName: icon, tint: tint)
            }
        }
    }
}

/// A row that leaves the app: same label, with the arrow that says so.
struct ExternalLinkRow: View {
    let title: String
    let icon: String
    let tint: Color
    let url: URL

    var body: some View {
        Link(destination: url) {
            HStack {
                SettingsLabel(title: title, icon: icon, tint: tint)
                Image(systemName: "arrow.up.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Color.textTertiary)
            }
        }
    }
}

/// The in-column title of a root list on a wide screen (see `ColumnTitle`),
/// as a row of its own with nothing behind it. Absent at compact width.
struct ListColumnTitle: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    let title: String

    var body: some View {
        if sizeClass == .regular {
            Section {
                ColumnTitleText(title: title)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 0))
            }
        }
    }
}

/// The house look for a grouped list: brand background, brand rows, and on a
/// wide screen one readable column instead of rows running edge to edge.
private struct HouseList: ViewModifier {
    @Environment(\.deviceScale) private var scale
    @State private var width: CGFloat = 0
    let maxWidth: CGFloat

    func body(content: Content) -> some View {
        content
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Color.appBackground.ignoresSafeArea())
            // Setting a margin replaces the inset style's own, so it is never
            // less than the screen-edge margin the rest of the app uses.
            .contentMargins(.horizontal, max(DeviceScale.margin(scale), (width - maxWidth * scale) / 2),
                            for: .scrollContent)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }
}

extension View {
    func houseList(maxWidth: CGFloat = 680) -> some View {
        modifier(HouseList(maxWidth: maxWidth))
    }

    /// Rows on the brand surface rather than the system's grouped grey.
    func houseRow() -> some View {
        listRowBackground(Color.appSurface)
    }
}
