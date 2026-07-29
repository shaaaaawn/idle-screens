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
    static var textPrimary: Color      { Color.textPrimary }
    static var textSecondary: Color    { Color.textSecondary }
    static var textTertiary: Color     { Color.textTertiary }
}
