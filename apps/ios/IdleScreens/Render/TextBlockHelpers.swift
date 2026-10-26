import Foundation

// MARK: - Deterministic text-block helpers
// Ports of packages/schema/src/simulate.ts line-breaking and reveal functions.
// Fixed character-width table — no platform metrics — so line breaks are
// identical across web, iOS, and tvOS.

// MARK: Character-width metrics (UTF-16 parity with the web engine)

private let narrowUnits: Set<UInt16> = Set("iIljtf1!|.,;:'\"()[]{}".utf16)
private let wideUnits: Set<UInt16> = Set("mwMWGOQD@%".utf16)

private func charWidthEmUnit(_ unit: UInt16) -> Double {
    if unit == 0x20 || unit == 0x09 { return 0.3 }
    if narrowUnits.contains(unit) { return 0.35 }
    if wideUnits.contains(unit) { return 0.72 }
    return 0.55
}

/// Every glyph's advance under a monospace `font` (simulate.ts MONO_ADVANCE_EM).
private let monoAdvanceEm = 0.6

/// `textMetricsClassFor`: a `font` naming a monospace family breaks on a
/// uniform 0.6 em advance, as the real face sets it.
func isMonoFont(_ font: String?) -> Bool {
    guard let font else { return false }
    return font.range(of: #"\b(?:ui-)?mono(?:space)?\b|courier|menlo|monaco|sfmono|consolas|inconsolata|fira\s*code|source\s*code|jetbrains|ibm\s*plex\s*mono|roboto\s*mono"#,
                      options: [.regularExpression, .caseInsensitive]) != nil
}

/// Combining (semi-)voiced kana marks ride on the preceding glyph.
private func isCombiningKana(_ cp: UInt32) -> Bool { cp == 0x3099 || cp == 0x309A }

/// `isFullWidth`: CJK, kana, Hangul and fullwidth forms advance a full em.
func isFullWidth(_ cp: UInt32) -> Bool {
    if isCombiningKana(cp) { return false }
    return (0x1100...0x115F).contains(cp) || (0x2E80...0x303E).contains(cp)
        || (0x3041...0x33FF).contains(cp) || (0x3400...0x4DBF).contains(cp)
        || (0x4E00...0x9FFF).contains(cp) || (0xA000...0xA4CF).contains(cp)
        || (0xA960...0xA97F).contains(cp) || (0xAC00...0xD7A3).contains(cp)
        || (0xF900...0xFAFF).contains(cp) || (0xFE30...0xFE4F).contains(cp)
        || (0xFF01...0xFF60).contains(cp) || (0xFFE0...0xFFE6).contains(cp)
        || (0x20000...0x3FFFD).contains(cp)
}

/// Em-width under the web's fixed table (simulate.ts `textWidthEm`): UTF-16
/// units for proportional faces, grapheme cells under `mono`, a full em for
/// a full-width glyph either way.
func textWidthEm(_ str: String, mono: Bool = false) -> Double {
    var w = 0.0
    if mono {
        for c in graphemeClusters(str) {
            guard let cp = c.unicodeScalars.first?.value, !isCombiningKana(cp) else { continue }
            w += isFullWidth(cp) ? 1 : monoAdvanceEm
        }
        return w
    }
    for scalar in str.unicodeScalars {
        let cp = scalar.value
        if isCombiningKana(cp) { continue }
        if isFullWidth(cp) { w += 1; continue }
        for unit in String(scalar).utf16 { w += charWidthEmUnit(unit) }
    }
    return w
}

// MARK: - Line breaking

struct TextBlockLine: Equatable, Sendable {
    var text: String
    var widthEm: Double
}

func breakTextBlock(text: String, maxWidthEm: Double, mono: Bool = false) -> [TextBlockLine] {
    let paragraphs = text.components(separatedBy: "\n")
    var lines: [TextBlockLine] = []

    for para in paragraphs {
        if para.isEmpty {
            lines.append(TextBlockLine(text: "", widthEm: 0))
            continue
        }
        let words = para.split(whereSeparator: \.isWhitespace).map(String.init)
        if words.isEmpty {
            lines.append(TextBlockLine(text: "", widthEm: 0))
            continue
        }

        var lineText = words[0]
        var lineW = textWidthEm(lineText, mono: mono)
        let spaceW = mono ? monoAdvanceEm : 0.3 // charWidthEm(' ')

        for i in 1..<words.count {
            let word = words[i]
            let wordW = textWidthEm(word, mono: mono)
            if lineW + spaceW + wordW <= maxWidthEm {
                lineText += " " + word
                lineW += spaceW + wordW
            } else {
                lines.append(TextBlockLine(text: lineText, widthEm: lineW))
                lineText = word
                lineW = wordW
            }
        }
        lines.append(TextBlockLine(text: lineText, widthEm: lineW))
    }

    return lines
}

// MARK: - Grapheme clustering (paint-safe Unicode segmentation)

private func isClusterExtend(_ cp: UInt32) -> Bool {
    (cp >= 0x0300 && cp <= 0x036F) ||
    (cp >= 0x1AB0 && cp <= 0x1AFF) ||
    (cp >= 0x20D0 && cp <= 0x20FF) ||
    (cp >= 0xFE00 && cp <= 0xFE0F) ||
    (cp >= 0x1F3FB && cp <= 0x1F3FF) ||
    cp == 0x20E3
}

private func isRegionalIndicator(_ cp: UInt32) -> Bool {
    cp >= 0x1F1E6 && cp <= 0x1F1FF
}

private let zwj: UInt32 = 0x200D

func graphemeClusters(_ text: String) -> [String] {
    let scalars = Array(text.unicodeScalars)
    var out: [String] = []
    var i = 0
    while i < scalars.count {
        let cp = scalars[i].value
        var end = i + 1
        if isRegionalIndicator(cp), end < scalars.count,
           isRegionalIndicator(scalars[end].value) {
            end += 1
        }
        while end < scalars.count {
            let next = scalars[end].value
            if isClusterExtend(next) {
                end += 1
            } else if next == zwj, end + 1 < scalars.count {
                end += 2
            } else {
                break
            }
        }
        var cluster = ""
        for j in i..<end { cluster.unicodeScalars.append(scalars[j]) }
        out.append(cluster)
        i = end
    }
    return out
}

// MARK: - Reveal state

struct RevealStateResult: Equatable, Sendable {
    var progress: Double
    var fullLines: Int
    var partialText: String
    var caretLine: Int
    var caretPrefix: String
    /// `glyphFade` only: each glyph's 0…1 alpha, per line, in reading order.
    var glyphAlphas: [[Double]]? = nil
}

func revealState(lines: [TextBlockLine], reveal: SpecSubset.TextRevealSpec,
                 t: TimeInterval) -> RevealStateResult {
    let lineClusters = lines.map { graphemeClusters($0.text) }
    let totalGraphemes = lineClusters.reduce(0) { $0 + $1.count }

    let authored = max(0, min(1, reveal.progress ?? 1))
    let speed = reveal.speed ?? 0
    let timed = speed > 0 && totalGraphemes > 0
        ? min(1, (speed * t) / Double(totalGraphemes))
        : 1.0
    let progress = min(authored, timed)

    let mode = reveal.mode ?? "typewriter"
    var fullLines = 0
    var partialText = ""

    // glyphFade: glyph g starts fading at (g/total)·(1−fade) and ramps to
    // opaque over a `fade`-wide window of progress; the frontier below
    // (shared with typewriter) still anchors the caret.
    var glyphAlphas: [[Double]]?
    if mode == "glyphFade" {
        let f = min(1, max(0.01, reveal.fade ?? 0.15))
        var g = 0
        glyphAlphas = lineClusters.map { clusters in
            clusters.map { _ in
                let start = totalGraphemes > 0 ? Double(g) / Double(totalGraphemes) * (1 - f) : 0
                g += 1
                return max(0, min(1, (progress - start) / f))
            }
        }
    }

    if mode == "line" {
        fullLines = Int((progress * Double(lines.count)).rounded())
    } else if mode == "word" {
        let lineWords = lines.map { line -> [String] in
            line.text.isEmpty ? [] : line.text.components(separatedBy: " ")
        }
        let totalWords = lineWords.reduce(0) { $0 + $1.count }
        var remaining = Int((progress * Double(totalWords)).rounded())
        for ws in lineWords {
            if remaining >= ws.count {
                remaining -= ws.count
                fullLines += 1
                continue
            }
            if remaining > 0 {
                partialText = ws[0..<remaining].joined(separator: " ")
            }
            break
        }
    } else {
        var remaining = Int((progress * Double(totalGraphemes)).rounded())
        for clusters in lineClusters {
            if remaining >= clusters.count {
                remaining -= clusters.count
                fullLines += 1
                continue
            }
            if remaining > 0 {
                partialText = clusters[0..<remaining].joined()
            }
            break
        }
    }

    let caretLine: Int
    let caretPrefix: String
    if !partialText.isEmpty {
        caretLine = fullLines
        caretPrefix = partialText
    } else if fullLines > 0 {
        caretLine = fullLines - 1
        caretPrefix = lines[fullLines - 1].text
    } else {
        caretLine = 0
        caretPrefix = ""
    }

    return RevealStateResult(progress: progress, fullLines: fullLines,
                             partialText: partialText,
                             caretLine: caretLine, caretPrefix: caretPrefix,
                             glyphAlphas: glyphAlphas)
}

// MARK: - Font (a CSS `font` family/weight list on the system's faces)

#if canImport(UIKit)
import UIKit

/// The face a textBlock `font` names, at `size` points: the first family in
/// the CSS stack that is installed on this device (as on the web, nothing is
/// bundled), else the system face in the stack's generic class — serif,
/// monospace or rounded — with its weight and slant.
enum TextBlockFont {
    nonisolated(unsafe) private static let cache = NSCache<NSString, UIFont>()

    static func uiFont(css: String?, size: CGFloat) -> UIFont {
        let key = "\(css ?? "")|\(size)" as NSString
        if let hit = cache.object(forKey: key) { return hit }
        let traits = SpecSubset.TextStyle(anchor: nil, font: css, opacity: nil).fontTraits
        let weight: UIFont.Weight = traits.bold ? .bold : .regular
        var font: UIFont?
        for family in families(css) {
            let names = UIFont.fontNames(forFamilyName: family)
            guard !names.isEmpty else { continue }
            var d = UIFontDescriptor(fontAttributes: [.family: family])
            var symbolic: UIFontDescriptor.SymbolicTraits = []
            if traits.bold { symbolic.insert(.traitBold) }
            if traits.italic { symbolic.insert(.traitItalic) }
            if !symbolic.isEmpty { d = d.withSymbolicTraits(symbolic) ?? d }
            font = UIFont(descriptor: d, size: size)
            break
        }
        if font == nil {
            let base = UIFont.systemFont(ofSize: size, weight: weight)
            let design: UIFontDescriptor.SystemDesign = traits.design == "mono" ? .monospaced
                : traits.design == "serif" ? .serif : traits.design == "rounded" ? .rounded : .default
            var d = base.fontDescriptor.withDesign(design) ?? base.fontDescriptor
            if traits.italic { d = d.withSymbolicTraits(d.symbolicTraits.union(.traitItalic)) ?? d }
            font = UIFont(descriptor: d, size: size)
        }
        let result = font ?? .systemFont(ofSize: size)
        cache.setObject(result, forKey: key)
        return result
    }

    /// The named families of a CSS font list, quotes and weight/style words
    /// stripped (generic families are left to the fallback).
    static func families(_ css: String?) -> [String] {
        guard let css else { return [] }
        let generic: Set<String> = ["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
                                    "ui-monospace", "ui-serif", "ui-sans-serif", "ui-rounded"]
        let words: Set<String> = ["bold", "bolder", "lighter", "normal", "italic", "oblique", "small-caps"]
        return css.split(separator: ",").compactMap { raw in
            var part = raw.trimmingCharacters(in: .whitespaces)
            // Leading weight/style tokens belong to the first family ("300 'Inter'").
            while let space = part.firstIndex(of: " "),
                  let head = Optional(String(part[..<space])),
                  words.contains(head.lowercased()) || Int(head) != nil {
                part = String(part[part.index(after: space)...]).trimmingCharacters(in: .whitespaces)
            }
            part = part.trimmingCharacters(in: CharacterSet(charactersIn: "'\""))
            return part.isEmpty || generic.contains(part.lowercased()) ? nil : part
        }
    }
}
#endif

// MARK: - textBlock.number

/// A counter (simulate.ts `textBlockText`): `prefix + value + suffix`, the
/// value rounded to `decimals` (0…6) places as JS `toFixed` does, thousands
/// grouped with commas unless `grouping: false`. Locale-free, so every device
/// paints the same digits.
struct TextNumber: Decodable, Equatable, Sendable {
    var value: Double
    var decimals: Double?
    var prefix: String?
    var suffix: String?
    var grouping: Bool?

    var formatted: String {
        let d = max(0, min(6, Int((decimals ?? 0).rounded())))
        let v = value.isFinite ? value : 0
        let fixed = Self.toFixed(abs(v), d)
        let parts = fixed.split(separator: ".", omittingEmptySubsequences: false)
        var whole = String(parts[0])
        if grouping != false {
            var out = ""
            for (i, ch) in whole.reversed().enumerated() {
                if i > 0, i % 3 == 0 { out.append(",") }
                out.append(ch)
            }
            whole = String(out.reversed())
        }
        let neg = v < 0 && (Double(fixed) ?? 0) != 0
        let frac = parts.count > 1 ? "." + parts[1] : ""
        return (prefix ?? "") + (neg ? "-" : "") + whole + frac + (suffix ?? "")
    }

    /// JS `toFixed`: it rounds the double's exact value, so only a true tie
    /// (exactly representable) goes away from zero; printf rounds it to even.
    static func toFixed(_ x: Double, _ d: Int) -> String {
        let scale = pow(10.0, Double(d))
        let a = abs(x)
        let scaled = a * scale
        // fma recovers the product's rounding error: zero only for an exact half.
        let err = fma(a, scale, -scaled)
        if err == 0, scaled - scaled.rounded(.down) == 0.5 {
            let n = scaled.rounded(.up) / scale
            return String(format: "%.\(d)f", x < 0 ? -n : n)
        }
        return String(format: "%.\(d)f", x)
    }
}
