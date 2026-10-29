import SwiftUI
import UIKit

extension Color {
    // Each colour is a light/dark pair. The chrome (Channels, Agents,
    // Settings, sheets) follows the appearance chosen in Settings; the Watch
    // feed and the TV app pin dark, so they always resolve the right-hand
    // value. Light is iOS's grouped-list greys with the brand violet darkened
    // enough to pass as text on white (#6655DD ≈ 5.6:1; #8B7CFF is 3.3:1).
    static let appBackground    = Color(light: "F2F2F7", dark: "0A0A0F")
    static let appSurface       = Color(light: "FFFFFF", dark: "14141C")
    static let appSurfaceRaised = Color(light: "E9E9F0", dark: "1D1D28")
    static let appBorder        = Color(light: "D5D5DE", dark: "2A2A38")
    static let appPrimary       = Color(light: "6655DD", dark: "8B7CFF")
    static let appAccent        = Color(light: "0E8A7B", dark: "5EEAD4")
    static let appSuccess       = Color(light: "248A3D", dark: "30D158")
    /// Softer than system red — errors here are recoverable ("that code
    /// expired"), and full-saturation red reads as damage.
    static let appDanger        = Color(light: "D93F3F", dark: "FF6B6B")
    /// "It didn't answer" — a condition to notice, not a failure to fix.
    static let appWarning       = Color(light: "B36A00", dark: "FFB454")
    static let textPrimary      = Color(light: "111114", dark: "FFFFFF")
    static let textSecondary    = Color(light: "6C6C72", dark: "8E8E93")
    static let textTertiary     = Color(light: "9C9CA3", dark: "48484A")

    /// A pair that resolves against the view's colour scheme, so a subtree
    /// pinned dark (`.environment(\.colorScheme, .dark)`) gets the dark value
    /// even while the app around it is light.
    init(light: String, dark: String) {
        let l = parseHexRGB(light), d = parseHexRGB(dark)
        self.init(uiColor: UIColor { traits in
            let c = traits.userInterfaceStyle == .light ? l : d
            return UIColor(red: c.0, green: c.1, blue: c.2, alpha: 1)
        })
    }

    init(hex: String) {
        let c = parseHexRGB(hex)
        self.init(red: c.0, green: c.1, blue: c.2)
    }
}

/// `#rrggbb` or `#rgb` (each digit doubled, as CSS reads it) → sRGB 0…1.
func parseHexRGB(_ hex: String) -> (Double, Double, Double) {
    var digits = hex.trimmingCharacters(in: .alphanumerics.inverted)
    if digits.count == 3 { digits = digits.map { "\($0)\($0)" }.joined() }
    var int: UInt64 = 0
    Scanner(string: digits).scanHexInt64(&int)
    return (Double((int >> 16) & 0xFF) / 255, Double((int >> 8) & 0xFF) / 255, Double(int & 0xFF) / 255)
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
        // Exactly six digits after expanding `#rgb`: this app's colour fields
        // are always `#rgb` / `#rrggbb` (FORMAT.md), never an 8-digit RGBA/ARGB
        // form, so anything else isn't a colour this function understands.
        // `>= 6` used to let a longer string through by silently truncating
        // to its first six digits, which is a guess, not the documented
        // "nil when the string isn't a colour" contract.
        guard hex.count == 6, let value = UInt64(hex, radix: 16) else { return nil }
        func linear(_ c: Double) -> Double {
            c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        let r = linear(Double((value >> 16) & 0xFF) / 255)
        let g = linear(Double((value >> 8) & 0xFF) / 255)
        let b = linear(Double(value & 0xFF) / 255)
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    /// Light enough that white text on it fails. The WCAG AA boundary for
    /// white (contrast 4.5:1) is background luminance ≈0.183 — solving
    /// `(1.05)/(L+0.05) = 4.5` — not the visually-intuitive 0.4 or 0.5. A
    /// mid-tone background between ~0.18 and 0.4 still fails white text even
    /// though it "looks dark", so the boundary has to be the WCAG one.
    static func isLight(hex: String?) -> Bool {
        (luminance(hex: hex) ?? 0) > 0.18
    }
}
