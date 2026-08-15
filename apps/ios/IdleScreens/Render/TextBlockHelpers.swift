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

func textWidthEm(_ str: String) -> Double {
    var w = 0.0
    for unit in str.utf16 { w += charWidthEmUnit(unit) }
    return w
}

// MARK: - Line breaking

struct TextBlockLine: Equatable, Sendable {
    var text: String
    var widthEm: Double
}

func breakTextBlock(text: String, maxWidthEm: Double) -> [TextBlockLine] {
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
        var lineW = textWidthEm(lineText)
        let spaceW = 0.3 // charWidthEm(' ')

        for i in 1..<words.count {
            let word = words[i]
            let wordW = textWidthEm(word)
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
                             caretLine: caretLine, caretPrefix: caretPrefix)
}
