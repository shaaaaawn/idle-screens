import SwiftUI

extension Color {
    static let appBackground    = Color(hex: "0A0A0F")
    static let appSurface       = Color(hex: "14141C")
    static let appSurfaceRaised = Color(hex: "1D1D28")
    static let appBorder        = Color(hex: "2A2A38")
    static let appPrimary       = Color(hex: "8B7CFF")
    static let appAccent        = Color(hex: "5EEAD4")
    static let appSuccess       = Color(hex: "30D158")
    /// Softer than system red — errors here are recoverable ("that code
    /// expired"), and full-saturation red reads as damage.
    static let appDanger        = Color(hex: "FF6B6B")
    /// "It didn't answer" — a condition to notice, not a failure to fix.
    static let appWarning       = Color(hex: "FFB454")
    static let textPrimary      = Color.white
    static let textSecondary    = Color(hex: "8E8E93")
    static let textTertiary     = Color(hex: "48484A")

    init(hex: String) {
        let hex = hex.trimmingCharacters(in: .alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r = Double((int >> 16) & 0xFF) / 255
        let g = Double((int >> 8) & 0xFF) / 255
        let b = Double(int & 0xFF) / 255
        self.init(red: r, green: g, blue: b)
    }
}

// Allow `.foregroundStyle(.textPrimary)` inside Button labels and other
// generic contexts where ShapeStyle inference fails for Color extensions.
extension ShapeStyle where Self == Color {
    static var appBackground: Color    { Color.appBackground }
    static var appSurface: Color       { Color.appSurface }
    static var appSurfaceRaised: Color { Color.appSurfaceRaised }
    static var appBorder: Color        { Color.appBorder }
    static var appPrimary: Color       { Color.appPrimary }
    static var appAccent: Color        { Color.appAccent }
    static var appSuccess: Color       { Color.appSuccess }
    static var appDanger: Color        { Color.appDanger }
    static var appWarning: Color       { Color.appWarning }
    static var textPrimary: Color      { Color.textPrimary }
    static var textSecondary: Color    { Color.textSecondary }
    static var textTertiary: Color     { Color.textTertiary }
}

// MARK: - Contrast against arbitrary artwork

extension Color {
    /// WCAG relative luminance of a hex colour, 0 (black) … 1 (white). nil when
    /// the string isn't a colour — callers should then assume dark, which is
    /// what most scenes are.
    static func luminance(hex: String?) -> Double? {
        guard var hex = hex?.trimmingCharacters(in: .alphanumerics.inverted), !hex.isEmpty else { return nil }
        if hex.count == 3 { hex = hex.map { "\($0)\($0)" }.joined() }
        guard hex.count >= 6, let value = UInt64(hex.prefix(6), radix: 16) else { return nil }
        func linear(_ c: Double) -> Double {
            c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        let r = linear(Double((value >> 16) & 0xFF) / 255)
        let g = linear(Double((value >> 8) & 0xFF) / 255)
        let b = linear(Double(value & 0xFF) / 255)
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    /// Light enough that white text on it fails. 0.4 rather than 0.5: white on
    /// a mid-tone is already hard to read, and dark text on it is fine.
    static func isLight(hex: String?) -> Bool {
        (luminance(hex: hex) ?? 0) > 0.4
    }
}
