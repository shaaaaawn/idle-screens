import OSLog
import SpriteKit
import SwiftUI

private let skLog = Logger(subsystem: "com.hermosalabs.idlescreens", category: "sprite-scene")

/// GPU renderer for compiled scenes — the t2 tier. Textured SpriteKit nodes
/// driven by the same SceneMotion math as the Canvas renderer, so the two
/// tiers agree frame-for-frame on placement. Built for the A8 / A10X floor,
/// where per-frame CPU rasterization (SwiftUI Canvas) cannot hold a frame
/// rate: textures are baked once and cached, then each frame only moves nodes.
/// Bonus over the Canvas tier: true additive blending (`.add`) and pre-baked
/// soft-glow textures, i.e. the web engine's `lighter` look for free.
///
/// Shape textures are baked WHITE and tinted per node, so a steered or
/// keyframed colour never bakes a new texture; and a recompile of the same
/// scene (a timeline tick, a steer, a morph frame) rebinds the existing nodes
/// in place instead of presenting a new scene.
struct SpriteSceneView: UIViewRepresentable {
    let layers: [CompiledLayer]
    let background: SpecSubset.Background?
    /// Paint no ground (a sequence segment over its bed).
    var transparentGround: Bool = false
    /// Seconds the scene has already been running (a copy drawn under its replacement).
    var clockOffset: TimeInterval = 0
    /// The scene's seed, which a `field` background hashes.
    var seed: Int = 0

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> SKView {
        let view = SKView()
        if transparentGround {
            view.allowsTransparency = true
            view.isOpaque = false
            view.backgroundColor = .clear
        }
        view.ignoresSiblingOrder = true
        view.preferredFramesPerSecond = 30
        context.coordinator.watch(view)
        return view
    }

    /// SpriteKit auto-pauses on resignActive, and a scene presented while the
    /// app is still activating (cold launch straight into a channel) can wedge
    /// paused forever — one frozen frame. Unpause on every activation edge.
    final class Coordinator {
        private var tokens: [NSObjectProtocol] = []

        func watch(_ view: SKView) {
            let unpause: @Sendable (Notification) -> Void = { [weak view] _ in
                MainActor.assumeIsolated {
                    view?.isPaused = false
                    view?.scene?.isPaused = false
                }
            }
            for name: Notification.Name in [
                UIApplication.didBecomeActiveNotification,
                UIApplication.willEnterForegroundNotification,
            ] {
                tokens.append(NotificationCenter.default.addObserver(
                    forName: name, object: nil, queue: .main, using: unpause))
            }
        }

        deinit {
            for token in tokens { NotificationCenter.default.removeObserver(token) }
        }
    }

    func updateUIView(_ view: SKView, context: Context) {
        // SpriteKit auto-pauses on resignActive; a scene presented during a
        // launch/foreground transition can wedge paused. Unpause defensively —
        // this view only exists while the saver should be animating.
        view.isPaused = false
        view.scene?.isPaused = false
        if let scene = view.scene as? CompiledSpriteScene {
            if scene.matches(layers, background) { return }  // same scene data — keep animating
            // A recompile of the same channel (keyframes, a steer, a morph
            // frame) keeps the scene, its clock and its texture cache.
            if scene.adopt(layers, background: background) { return }
        }
        let scene = CompiledSpriteScene(layers: layers, background: background,
                                        transparentGround: transparentGround, seed: seed)
        scene.clockOffset = clockOffset
        // A recompile of the same channel keeps the clock: restarting it would
        // snap every entity back to where it was at t=0.
        scene.startTime = (view.scene as? CompiledSpriteScene)?.startTime
        scene.scaleMode = .resizeFill
        view.presentScene(scene)
    }
}

final class CompiledSpriteScene: SKScene {
    /// Total on-screen node budget. SpriteKit on A8 comfortably animates
    /// hundreds of textured quads at 1080p; thin by stride above this.
    private static let nodeBudget = 500

    private var layersData: [CompiledLayer]
    private var bg: SpecSubset.Background?

    /// One node, the entity that drives it and its layer. `pass` is 1 for a
    /// morph's outgoing-words copy (`text: crossfade | dip`), else 0. `key`
    /// is what the node's texture shows, so a per-frame change (a cycled
    /// glyph, a typing reveal) re-textures only when it must.
    private struct Driven {
        let node: SKSpriteNode
        var entity: CompiledEntity
        var layer: Int
        var index: Int
        var pass: Int
        var key: String = ""
    }
    private var driven: [Driven] = []
    private var textures: [String: SKTexture] = [:]
    fileprivate(set) var startTime: TimeInterval?
    fileprivate var clockOffset: TimeInterval = 0
    private var builtForSize: CGSize = .zero

    private let transparentGround: Bool
    private let seed: UInt32
    /// The ground node, and the key of what it shows: a drifting gradient or
    /// field re-textures when its key moves on (the web's 100 ms field bucket).
    private var groundNode: SKSpriteNode?
    private var groundKey: String?

    init(layers: [CompiledLayer], background: SpecSubset.Background?, transparentGround: Bool = false,
         seed: Int = 0) {
        self.layersData = layers
        self.bg = background
        self.transparentGround = transparentGround
        self.seed = normalizedRenderSeed(seed)
        super.init(size: .zero)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("unused") }

    func matches(_ layers: [CompiledLayer], _ background: SpecSubset.Background?) -> Bool {
        layersData == layers && bg == background
    }

    /// Take a recompiled version of the scene on screen without presenting a
    /// new one: nodes are rebuilt from the (cached, tinted) textures and the
    /// clock runs on. False before the scene has a size to build at.
    func adopt(_ layers: [CompiledLayer], background: SpecSubset.Background?) -> Bool {
        guard size.width > 0, size.height > 0 else { return false }
        layersData = layers
        if background != bg {
            bg = background
            groundKey = nil
        }
        for d in driven { d.node.removeFromParent() }
        driven.removeAll(keepingCapacity: true)
        buildNodes()
        return true
    }

    override func didMove(to view: SKView) {
        backgroundColor = transparentGround ? .clear : .black
        isPaused = false
        view.isPaused = false
        rebuildIfNeeded()
    }

    override func didChangeSize(_ oldSize: CGSize) {
        super.didChangeSize(oldSize)
        rebuildIfNeeded()
    }

    private func rebuildIfNeeded() {
        guard size.width > 0, size.height > 0, size != builtForSize else { return }
        builtForSize = size
        removeAllChildren()
        driven.removeAll()
        groundNode = nil
        if !transparentGround { buildBackground() }
        buildNodes()
        skLog.notice("built \(self.driven.count) nodes at \(self.size.width)x\(self.size.height) scene=\(ObjectIdentifier(self).debugDescription)")
    }

    // MARK: - Ground

    private func buildBackground() {
        let node = SKSpriteNode(texture: nil)
        node.size = size
        node.position = CGPoint(x: size.width / 2, y: size.height / 2)
        node.zPosition = -1
        addChild(node)
        groundNode = node
        groundKey = nil
        updateGround(t: 0)
    }

    /// What the ground shows at `t` (seconds): changes only when a drift moves
    /// it far enough to see (a gradient at 10 Hz, a field per 100 ms bucket).
    private func groundKey(at t: TimeInterval) -> String {
        guard let bg else { return "none" }
        if bg.isField { return "field|\(FieldSampler.sampleTime(bg, t * 1000))" }
        if bg.drift != nil, bg.stops != nil { return "grad|\(Int(t * 10))" }
        return "static"
    }

    private func updateGround(t: TimeInterval) {
        guard let node = groundNode else { return }
        let key = groundKey(at: t)
        guard key != groundKey else { return }
        groundKey = key
        if let bg, bg.isField,
           let ras = FieldRaster.raster(bg, seed: seed, width: size.width, height: size.height,
                                        t: t * 1000, shortSide: FieldSampler.shortSideLow) {
            let tex = SKTexture(cgImage: ras.image)
            tex.filteringMode = ras.crisp ? .nearest : .linear
            node.texture = tex
            return
        }
        node.texture = backgroundTexture(t: t)
    }

    private func backgroundTexture(t: TimeInterval) -> SKTexture {
        // 1pt-wide vertical strip at full height, stretched across — cheap,
        // and a band's edge stays where the spec puts it.
        let h = max(2, Int(size.height))
        let img = UIGraphicsImageRenderer(size: CGSize(width: 1, height: CGFloat(h))).image { ctx in
            let cg = ctx.cgContext
            if let bg, let raw = bg.stops, !raw.isEmpty {
                // Drifted and sorted the way the Canvas tier (and the web) does.
                let stops = bg.driftedStops(at: t * 1000).enumerated()
                    .sorted { $0.element.at != $1.element.at ? $0.element.at < $1.element.at : $0.offset < $1.offset }
                    .map(\.element)
                let colors = stops.map { UIColor(hexString: $0.color).cgColor } as CFArray
                let locations = stops.map { CGFloat(min(1, max(0, $0.at))) }
                if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                                             colors: colors, locations: locations) {
                    cg.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: 0, y: h),
                                          options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
                }
                // A band belongs to a gradient ground, in the spec's units.
                if let band = bg.band, band.height > 0 {
                    let px = layersData.first?.units == .px
                    let bh = band.height * (px ? 1 : min(size.width, size.height)) * CGFloat(h) / size.height
                    UIColor(hexString: band.color).setFill()
                    cg.fill(CGRect(x: 0, y: CGFloat(h) - bh, width: 1, height: bh))
                }
            } else {
                UIColor(hexString: bg?.primaryColor ?? "05050a").setFill()
                cg.fill(CGRect(x: 0, y: 0, width: 1, height: h))
            }
        }
        return SKTexture(image: img)
    }

    // MARK: - Build

    private func buildNodes() {
        let total = layersData.reduce(0) { $0 + $1.entities.count * ($1.textCrossfade != nil ? 2 : 1) }
        let stride = max(1, Int((Double(total) / Double(Self.nodeBudget)).rounded(.up)))
        for (li, layer) in layersData.enumerated() {
            let dim = layer.units == .px ? 1 : min(size.width, size.height)
            let passes = layer.textCrossfade != nil ? [1, 0] : [0]
            for (i, entity) in layer.entities.enumerated() {
                if stride > 1, i % stride != 0 { continue }
                for pass in passes {
                    var e = entity
                    if pass == 1, let glyphs = layer.textCrossfade?.outGlyphs, glyphs.indices.contains(i) {
                        e.glyph = glyphs[i]
                    }
                    let sprite = pass == 1 ? (layer.textCrossfade?.outgoing ?? layer.sprite) : layer.sprite
                    guard let node = makeNode(entity: e, sprite: sprite, layer: layer, dim: dim, t: 0) else { continue }
                    node.zPosition = CGFloat(li)
                    switch layer.blend {
                    case "lighter": node.blendMode = .add
                    case "screen": node.blendMode = .screen
                    case "multiply": node.blendMode = .multiply
                    default: node.blendMode = .alpha
                    }
                    addChild(node)
                    driven.append(Driven(node: node, entity: e, layer: li, index: i, pass: pass,
                                         key: textureKey(e, sprite: sprite, layer: layer, dim: dim, t: 0)))
                }
            }
        }
    }

    /// Tint a white texture with the entity's colour (exact for white).
    private func tint(_ node: SKSpriteNode, _ entity: CompiledEntity) {
        node.color = UIColor(red: entity.red, green: entity.green, blue: entity.blue, alpha: 1)
        node.colorBlendFactor = 1
    }

    private func makeNode(entity: CompiledEntity, sprite: SpecSubset.Sprite, layer: CompiledLayer,
                          dim: CGFloat, t: TimeInterval) -> SKSpriteNode? {
        let defaultWidth = layer.units == .px ? 2.0 : 0.002
        switch sprite {
        case .circle(_, _, _, let soft):
            let r = entity.size * dim
            guard r > 0.25 else { return nil }  // sub-pixel content: skip
            let node = SKSpriteNode(texture: circleTexture(soft: soft))
            node.size = CGSize(width: r * 2, height: r * 2)
            tint(node, entity)
            return node

        case .ring(_, _, _, let width):
            let r = entity.size * dim
            guard r > 0.25 else { return nil }
            let lw = max(0.5, (width ?? defaultWidth) * dim)
            let node = SKSpriteNode(texture: ringTexture(widthRatio: min(1, max(0.01, lw / r))))
            node.size = CGSize(width: r * 2, height: r * 2)
            tint(node, entity)
            return node

        case .rect:
            let w = entity.size * dim
            guard w > 0.25 else { return nil }
            let h = w * entity.aspect
            let node: SKSpriteNode
            if layer.feather > 0 {
                // Soft edges: the separable feather ramp baked per aspect bucket.
                node = SKSpriteNode(texture: featherTexture(layer.feather, aspect: entity.aspect))
            } else {
                node = SKSpriteNode(color: .white, size: .zero)
            }
            node.size = CGSize(width: w, height: h)
            tint(node, entity)
            return node

        case .streak(_, _, _, let width):
            let length = entity.size * dim
            guard length > 0.25 else { return nil }
            // A clear tail fading to the head, round-capped; the heading is
            // set every frame from the real path (update).
            let node = SKSpriteNode(texture: streakTexture())
            node.size = CGSize(width: length, height: max(0.5, (width ?? defaultWidth) * dim))
            node.anchorPoint = CGPoint(x: 1, y: 0.5)  // the head sits on the point
            tint(node, entity)
            return node

        case .emoji, .text:
            guard let glyph = SceneMotion.glyph(of: entity, sprite: sprite, at: t) else { return nil }
            let px = entity.size * dim
            guard px > 0.5 else { return nil }
            let isEmoji: Bool = { if case .emoji = sprite { return true } else { return false } }()
            let style = isEmoji ? nil : layer.textSprite
            let node = SKSpriteNode(texture: glyphTexture(glyph: glyph, size: px, style: style,
                                                          units: layer.units, dim: dim))
            if let style {
                let ax: CGFloat = style.align == "left" || style.align == "start" ? 0
                    : style.align == "right" || style.align == "end" ? 1 : 0.5
                let ay: CGFloat = style.baseline == "top" || style.baseline == "hanging" ? 1
                    : style.baseline == "bottom" || style.baseline == "ideographic" ? 0 : 0.5
                node.anchorPoint = CGPoint(x: ax, y: ay)
                if let mw = style.maxWidth.map({ $0 * (layer.units == .px ? 1 : dim) }),
                   let tex = node.texture, tex.size().width > mw {
                    node.size = CGSize(width: mw, height: tex.size().height)
                }
            }
            // Emoji keep their own colours; words are tinted.
            if !isEmoji { tint(node, entity) }
            return node

        case .textBlock(let text, let maxWidth, let fontSize, let lineHeight,
                        let align, let color, let reveal):
            let fsPx = fontSize * dim
            guard fsPx > 1 else { return nil }
            let node = SKSpriteNode(texture: textBlockTexture(
                text: text, maxWidth: maxWidth, fontSize: fontSize, lineHeight: lineHeight, align: align,
                color: color, style: layer.textStyle, reveal: reveal, dim: dim, t: t))
            node.anchorPoint = CGPoint(x: 0, y: 1)
            // `anchor` names a point of the INK (widest line × lines, as
            // `align` placed it) for `position` — the Canvas tier's
            // TextStyle.anchorOffset, expressed as the node's anchor point.
            if let style = layer.textStyle, style.anchor != nil {
                let lines = breakTextBlock(text: text, maxWidthEm: maxWidth * dim / fsPx, mono: isMonoFont(style.font))
                let widest = lines.map(\.widthEm).max().map { $0 * fsPx } ?? 0
                let boxW = ceil(max(1, maxWidth * dim))
                let boxH = ceil(max(1, CGFloat(lines.count) * lineHeight * fsPx))
                let off = style.anchorOffset(align: align, maxWidthPx: maxWidth * dim, widestLinePx: widest,
                                             totalHeightPx: CGFloat(lines.count) * lineHeight * fsPx)
                node.anchorPoint = CGPoint(x: -off.dx / boxW, y: 1 + off.dy / boxH)
            }
            return node

        case .polygon(_, _, _, let sides, let points, let soft, let drawing):
            let r = entity.size * dim
            guard r > 0.25 else { return nil }
            if let drawing {
                // A path drawing: the shared raster (PathRaster) as a texture,
                // anchored at the drawing's origin. SpriteKit is y-up, so the
                // anchor's y flips. Grow/rotation then act on the node as usual.
                guard let ras = PathRaster.raster(drawing, color: entity.color, r: r,
                                                  width: size.width, height: size.height,
                                                  scale: NativeSceneView.rasterScale) else { return nil }
                let tex = texture(key: "path|\(drawing.key.hashValue)|\(entity.color)|\(ras.image.width)x\(ras.image.height)") {
                    UIImage(cgImage: ras.image)
                }
                let uniform = drawing.span == "box"
                let k = uniform ? r / pow(2, ceil(log2(max(r, 0.5)) * 8) / 8) : 1
                let node = SKSpriteNode(texture: tex)
                node.size = CGSize(width: CGFloat(ras.image.width) / ras.scale * k,
                                   height: CGFloat(ras.image.height) / ras.scale * k)
                node.anchorPoint = CGPoint(x: ras.anchor.x / CGFloat(ras.image.width),
                                           y: 1 - ras.anchor.y / CGFloat(ras.image.height))
                return node
            }
            let node = SKSpriteNode(texture: polygonTexture(sides: sides, points: points, soft: soft))
            node.size = CGSize(width: r * 2, height: r * 2)
            tint(node, entity)
            return node

        case .stroke(_, let points, _, _, let width, let smooth, let taper, _):
            let length = entity.size * dim
            guard length > 0.5 else { return nil }
            // The mark is baked into a square texture spanning its own unit
            // box, so one texture serves every entity of the layer.
            let node = SKSpriteNode(texture: strokeTexture(
                points: points, smooth: smooth, taper: taper,
                widthRatio: min(1, max(0.004, ((width ?? defaultWidth) * dim) / length)),
                span: layer.strokeDraw?.span))
            node.size = CGSize(width: length, height: length)
            tint(node, entity)
            return node

        case .bar(let values, _, _, _, _, let maxValue, let direction):
            let len = entity.size * dim
                * NativeSceneView.barFraction(values: values, max: maxValue, index: entity.barIndex)
            guard len > 0.25 else { return nil }
            let thick = entity.thickness > 0 ? entity.thickness * dim : entity.size * dim * 0.2
            let horizontal = direction != "up" && direction != "down"
            let node = SKSpriteNode(color: .white, size:
                CGSize(width: horizontal ? len : thick, height: horizontal ? thick : len))
            tint(node, entity)
            // Bars grow FROM their position, so the anchor sits at the root.
            switch direction {
            case "left":  node.anchorPoint = CGPoint(x: 1, y: 0.5)
            case "up":    node.anchorPoint = CGPoint(x: 0.5, y: 0)   // SpriteKit y is up
            case "down":  node.anchorPoint = CGPoint(x: 0.5, y: 1)
            default:      node.anchorPoint = CGPoint(x: 0, y: 0.5)
            }
            return node

        case .unknown:
            return nil
        }
    }

    /// What a node's texture shows when it can change while the scene runs:
    /// a cycled glyph, or a textBlock's reveal state. Empty for the rest.
    private func textureKey(_ e: CompiledEntity, sprite: SpecSubset.Sprite, layer: CompiledLayer,
                            dim: CGFloat, t: TimeInterval) -> String {
        switch sprite {
        case .emoji, .text:
            return e.cyclePeriod > 0 ? (SceneMotion.glyph(of: e, sprite: sprite, at: t) ?? "") : ""
        case .textBlock(let text, let maxWidth, let fontSize, _, _, _, let reveal):
            guard let reveal else { return "" }
            return Self.revealKey(text: text, maxWidth: maxWidth, fontSize: fontSize, style: layer.textStyle,
                                  reveal: reveal, dim: dim, t: t)
        default:
            return ""
        }
    }

    /// A reveal's visible state, quantised so the texture re-bakes only when
    /// a glyph appears (or, under glyphFade, an alpha moves by ~1/16) or the
    /// caret blinks.
    private static func revealKey(text: String, maxWidth: Double, fontSize: Double,
                                  style: SpecSubset.TextStyle?, reveal: SpecSubset.TextRevealSpec,
                                  dim: CGFloat, t: TimeInterval) -> String {
        let fsPx = fontSize * dim
        let lines = breakTextBlock(text: text, maxWidthEm: maxWidth * dim / max(0.5, fsPx), mono: isMonoFont(style?.font))
        let rs = revealState(lines: lines, reveal: reveal, t: t)
        var key = "\(rs.fullLines)|\(rs.partialText.count)"
        if let alphas = rs.glyphAlphas {
            key += "|" + alphas.map { $0.map { String(Int(($0 * 16).rounded())) }.joined(separator: ",") }.joined(separator: ";")
        }
        if let caret = reveal.caret {
            let hz = min(3.0, caret.blink ?? 1.2)
            key += "|c\(hz <= 0 || Int(t * hz * 2) % 2 == 0 ? 1 : 0)"
        }
        return key
    }

    // MARK: - Texture cache

    private func texture(key: String, _ make: () -> UIImage) -> SKTexture {
        if let cached = textures[key] { return cached }
        let tex = SKTexture(image: make())
        textures[key] = tex
        // A long typing reveal bakes many states: keep the cache bounded.
        if textures.count > 512 { textures.removeAll(keepingCapacity: true); textures[key] = tex }
        return tex
    }

    private func circleTexture(soft: Bool) -> SKTexture {
        texture(key: "c|\(soft)") {
            let d: CGFloat = 128
            return UIGraphicsImageRenderer(size: CGSize(width: d, height: d)).image { ctx in
                let cg = ctx.cgContext
                if soft {
                    // Web-parity falloff (compile.ts): bright core to 35% of
                    // the radius, then fade to transparent.
                    let colors = [UIColor.white.cgColor, UIColor.white.withAlphaComponent(0.75).cgColor,
                                  UIColor.white.withAlphaComponent(0).cgColor] as CFArray
                    if let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                                          colors: colors, locations: [0, 0.35, 1]) {
                        cg.drawRadialGradient(
                            g, startCenter: CGPoint(x: d / 2, y: d / 2), startRadius: 0,
                            endCenter: CGPoint(x: d / 2, y: d / 2), endRadius: d / 2,
                            options: [])
                    }
                } else {
                    UIColor.white.setFill()
                    cg.fillEllipse(in: CGRect(x: 0, y: 0, width: d, height: d))
                }
            }
        }
    }

    private func ringTexture(widthRatio: CGFloat) -> SKTexture {
        // Quantize the stroke ratio so similar rings share one texture.
        let q = (widthRatio * 32).rounded() / 32
        return texture(key: "r|\(q)") {
            let d: CGFloat = 128
            return UIGraphicsImageRenderer(size: CGSize(width: d, height: d)).image { ctx in
                let cg = ctx.cgContext
                let lw = max(1, q * d / 2)
                UIColor.white.setStroke()
                cg.setLineWidth(lw)
                cg.strokeEllipse(in: CGRect(x: lw / 2, y: lw / 2, width: d - lw, height: d - lw))
            }
        }
    }

    /// A streak: transparent at the tail (left) to opaque at the head, with a
    /// round cap — the web's gradient line.
    private func streakTexture() -> SKTexture {
        texture(key: "streak") {
            let w: CGFloat = 128, h: CGFloat = 8
            return UIGraphicsImageRenderer(size: CGSize(width: w, height: h)).image { ctx in
                let cg = ctx.cgContext
                cg.addPath(UIBezierPath(roundedRect: CGRect(x: 0, y: 0, width: w, height: h), cornerRadius: h / 2).cgPath)
                cg.clip()
                let colors = [UIColor.white.withAlphaComponent(0).cgColor, UIColor.white.cgColor] as CFArray
                if let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
                    cg.drawLinearGradient(g, start: .zero, end: CGPoint(x: w, y: 0), options: [])
                }
            }
        }
    }

    /// `rect.feather`'s separable ramp (shapes.ts `featherRamp`) on a white
    /// rect, one texture per (feather, aspect) bucket.
    private func featherTexture(_ feather: Double, aspect: Double) -> SKTexture {
        let qa = max(0.05, (aspect * 8).rounded() / 8)
        let qf = (feather * 32).rounded() / 32
        return texture(key: "feather|\(qf)|\(qa)") {
            let w: CGFloat = 64, h = max(4, min(256, (64 * qa).rounded()))
            let stops = NativeSceneView.featherStops(qf)
            func ramp(_ u: Double) -> Double {
                for k in 1..<stops.count where u <= stops[k].at {
                    let a = stops[k - 1], b = stops[k]
                    return a.alpha + (b.alpha - a.alpha) * (u - a.at) / max(1e-9, b.at - a.at)
                }
                return stops.last?.alpha ?? 1
            }
            return UIGraphicsImageRenderer(size: CGSize(width: w, height: h)).image { ctx in
                for y in 0..<Int(h) {
                    for x in 0..<Int(w) {
                        let a = ramp((Double(x) + 0.5) / Double(w)) * ramp((Double(y) + 0.5) / Double(h))
                        UIColor.white.withAlphaComponent(a).setFill()
                        ctx.fill(CGRect(x: x, y: y, width: 1, height: 1))
                    }
                }
            }
        }
    }

    /// A polygon facet baked once per shape — white, tinted per node.
    private func polygonTexture(sides: Int?, points: [[Double]]?, soft: Bool) -> SKTexture {
        let shape = points?.map { $0.map { String(format: "%.3f", $0) }.joined(separator: ",") }
            .joined(separator: ";") ?? "n\(sides ?? 6)"
        return texture(key: "p|\(shape)|\(soft)") {
            let d: CGFloat = 128
            return UIGraphicsImageRenderer(size: CGSize(width: d, height: d)).image { ctx in
                let cg = ctx.cgContext
                let verts = NativeSceneView.polygonPoints(sides: sides, points: points, radius: Double(d / 2))
                guard verts.count >= 3 else { return }
                let path = UIBezierPath()
                path.move(to: CGPoint(x: verts[0].x + d / 2, y: verts[0].y + d / 2))
                for v in verts.dropFirst() { path.addLine(to: CGPoint(x: v.x + d / 2, y: v.y + d / 2)) }
                path.close()
                if soft {
                    cg.saveGState()
                    cg.addPath(path.cgPath)
                    cg.clip()
                    let colors = [UIColor.white.cgColor, UIColor.white.withAlphaComponent(0.75).cgColor,
                                  UIColor.white.withAlphaComponent(0).cgColor] as CFArray
                    if let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                                          colors: colors, locations: [0, 0.35, 1]) {
                        cg.drawRadialGradient(g, startCenter: CGPoint(x: d / 2, y: d / 2), startRadius: 0,
                                              endCenter: CGPoint(x: d / 2, y: d / 2), endRadius: d / 2, options: [])
                    }
                    cg.restoreGState()
                } else {
                    UIColor.white.setFill()
                    path.fill()
                }
            }
        }
    }

    /// A brush mark baked once per (path, width) into its unit box.
    /// `span`: a draw-on window, quantised to 1/128 of the length so a glide
    /// re-bakes ~128 textures across a whole draw, not one per frame.
    private func strokeTexture(points: [[Double]], smooth: Bool, taper: Bool, widthRatio: CGFloat,
                               span: (Double, Double)? = nil) -> SKTexture {
        let shape = points.map { $0.map { String(format: "%.3f", $0) }.joined(separator: ",") }
            .joined(separator: ";")
        let q = (widthRatio * 64).rounded() / 64
        let qs = span.map { ((($0.0 * 128).rounded()) / 128, (($0.1 * 128).rounded()) / 128) }
        return texture(key: "s|\(shape)|\(smooth)|\(taper)|\(q)|\(qs.map { "\($0.0)-\($0.1)" } ?? "all")") {
            let d: CGFloat = 128
            return UIGraphicsImageRenderer(size: CGSize(width: d, height: d)).image { ctx in
                let cg = ctx.cgContext
                cg.setStrokeColor(UIColor.white.cgColor)
                cg.setLineCap(.round)
                cg.setLineJoin(.round)
                var samples = NativeSceneView.strokeSamples(points: points, halfSize: Double(d / 2), smooth: smooth)
                if let qs { samples = DrawOn.trim(samples, qs.0, qs.1) }
                guard samples.count >= 2 else { return }
                let lw = max(0.5, q * d)
                func p(_ i: Int) -> CGPoint { CGPoint(x: samples[i].x + d / 2, y: samples[i].y + d / 2) }
                if taper {
                    // One filled outline, as on the Canvas tier and the web.
                    let outline = NativeSceneView.strokeOutline((0..<samples.count).map(p), lineWidth: lw)
                    cg.setFillColor(UIColor.white.cgColor)
                    cg.beginPath()
                    cg.addLines(between: outline)
                    cg.closePath()
                    cg.fillPath()
                } else {
                    cg.setLineWidth(lw)
                    cg.beginPath()
                    cg.move(to: p(0))
                    for i in 1..<samples.count { cg.addLine(to: p(i)) }
                    cg.strokePath()
                }
            }
        }
    }

    /// A textBlock as the web paints it at `t`: the CSS face (or the system
    /// one), the fixed metrics table for layout, the reveal — typed, word or
    /// line frontier, or glyphFade's per-glyph alphas with `rise` — and the
    /// caret. Keyed by its visible state, so typing re-bakes per glyph.
    private func textBlockTexture(text: String, maxWidth: Double, fontSize: Double, lineHeight: Double,
                                  align: String, color: String, style: SpecSubset.TextStyle?,
                                  reveal: SpecSubset.TextRevealSpec?, dim: CGFloat, t: TimeInterval) -> SKTexture {
        let fsPx = fontSize * dim
        let lh = lineHeight * fsPx
        let maxWPx = maxWidth * dim
        let lines = breakTextBlock(text: text, maxWidthEm: maxWPx / fsPx, mono: isMonoFont(style?.font))
        let canvasW = ceil(max(1, maxWPx))
        let canvasH = ceil(max(1, CGFloat(lines.count) * lh))
        let state = reveal.map { Self.revealKey(text: text, maxWidth: maxWidth, fontSize: fontSize, style: style,
                                               reveal: $0, dim: dim, t: t) } ?? "all"
        let key = "tb|\(text.hashValue)|\(Int(fsPx))|\(Int(canvasW))|\(align)|\(color)|\(style?.font ?? "")|\(state)"
        return texture(key: key) {
            let font = TextBlockFont.uiFont(css: style?.font, size: fsPx)
            let ui = UIColor(hexString: color)
            let rs = reveal.map { revealState(lines: lines, reveal: $0, t: t) }
            return UIGraphicsImageRenderer(size: CGSize(width: canvasW, height: canvasH)).image { _ in
                func x0(_ s: String) -> CGFloat {
                    let w = (s as NSString).size(withAttributes: [.font: font]).width
                    return align == "center" ? (maxWPx - w) / 2 : align == "right" ? maxWPx - w : 0
                }
                func draw(_ s: String, at p: CGPoint, alpha: CGFloat = 1) {
                    (s as NSString).draw(at: p, withAttributes: [.font: font, .foregroundColor: ui.withAlphaComponent(alpha)])
                }
                if let alphas = rs?.glyphAlphas {
                    let riseEm = min(NativeSceneView.maxRevealRise, max(0, reveal?.rise ?? 0))
                    for (li, line) in lines.enumerated() {
                        let la = li < alphas.count ? alphas[li] : []
                        if let first = la.first, first <= 0 { break }
                        let clusters = graphemeClusters(line.text)
                        let left = x0(line.text)
                        var prefix = ""
                        for (gi, g) in clusters.enumerated() {
                            let a = gi < la.count ? la[gi] : 0
                            if a <= 0 { break }
                            let px = left + (prefix as NSString).size(withAttributes: [.font: font]).width
                            draw(g, at: CGPoint(x: px, y: CGFloat(li) * lh + riseEm * fsPx * (1 - a)), alpha: a)
                            prefix += g
                        }
                    }
                } else {
                    let full = rs?.fullLines ?? lines.count
                    for li in 0..<min(full, lines.count) {
                        draw(lines[li].text, at: CGPoint(x: x0(lines[li].text), y: CGFloat(li) * lh))
                    }
                    if let rs, !rs.partialText.isEmpty, rs.fullLines < lines.count {
                        // Aligned on its own, as the web's fillText(partial, xOff) is.
                        draw(rs.partialText, at: CGPoint(x: x0(rs.partialText), y: CGFloat(rs.fullLines) * lh))
                    }
                }
                if let rs, let caret = reveal?.caret {
                    let hz = min(3.0, caret.blink ?? 1.2)
                    if hz <= 0 || Int(t * hz * 2) % 2 == 0 {
                        let pw = (rs.caretPrefix as NSString).size(withAttributes: [.font: font]).width
                        let xOff: CGFloat = align == "center" ? maxWPx / 2 : align == "right" ? maxWPx : 0
                        let cx: CGFloat = align == "center" ? xOff + pw / 2 : align == "right" ? xOff : pw
                        UIColor(hexString: caret.color ?? color).setFill()
                        UIRectFill(CGRect(x: cx + fsPx * 0.06, y: CGFloat(rs.caretLine) * lh,
                                          width: max(1, fsPx * 0.08), height: fsPx))
                    }
                }
            }
        }
    }

    /// One glyph or string, white (words are tinted; emoji keep their colours),
    /// in a text sprite's CSS face when it names one.
    private func glyphTexture(glyph: String, size: CGFloat, style: SpecSubset.TextSpriteStyle?,
                              units: SpecSubset.Units, dim: CGFloat) -> SKTexture {
        var px = size
        if let f = style?.font, let r = f.range(of: #"(\d{1,5}(?:\.\d{1,4})?|\.\d{1,4})px"#, options: .regularExpression),
           let n = Double(f[r].dropLast(2)) {
            px = n * (units == .px ? 1 : dim / 1080)
        }
        return texture(key: "g|\(glyph)|\(Int(px * 4))|\(style?.font ?? "")") {
            let font = style?.font != nil ? TextBlockFont.uiFont(css: style?.font, size: px) : UIFont.systemFont(ofSize: px)
            let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.white]
            let bounds = (glyph as NSString).size(withAttributes: attrs)
            let canvas = CGSize(width: ceil(max(1, bounds.width)), height: ceil(max(1, bounds.height)))
            return UIGraphicsImageRenderer(size: canvas).image { _ in
                (glyph as NSString).draw(at: .zero, withAttributes: attrs)
            }
        }
    }

    // MARK: - Frame update

    override func update(_ currentTime: TimeInterval) {
        let start = startTime ?? (currentTime - clockOffset)
        if startTime == nil {
            startTime = start
            skLog.notice("first tick scene=\(ObjectIdentifier(self).debugDescription)")
        }
        let t = currentTime - start
        updateGround(t: t)

        for k in driven.indices {
            let d = driven[k]
            let node = d.node, entity = d.entity
            let layer = layersData[d.layer]
            let dim = layer.units == .px ? 1 : min(size.width, size.height)
            let sprite = d.pass == 1 ? (layer.textCrossfade?.outgoing ?? layer.sprite) : layer.sprite
            let parentEntity = layer.orbitParentKey.flatMap { key in
                layersData.first { $0.key == key }?.entities.first
            }
            // A cycled glyph or a typing reveal re-textures when what it shows moves on.
            let key = textureKey(entity, sprite: sprite, layer: layer, dim: dim, t: t)
            if key != d.key {
                driven[k].key = key
                if let fresh = makeNode(entity: entity, sprite: sprite, layer: layer, dim: dim, t: t) {
                    node.texture = fresh.texture
                    node.size = fresh.size
                    node.anchorPoint = fresh.anchorPoint
                }
            }
            var p = SceneMotion.position(of: entity, at: t, in: size,
                                         dim: dim, wrap: layer.wrap, parent: parentEntity)
            // A paint transform moves the point through G·L; a node can't
            // take a full affine, so it also takes the summed rotation and
            // per-axis scale (exact unless a rotated layer is scaled unevenly).
            if let paint = layer.paint { p = p.applying(paint.affine(in: size, unit: dim)) }
            // Compile space is top-left y-down; SpriteKit is bottom-left y-up.
            node.position = CGPoint(x: p.x, y: size.height - p.y)
            // The layer's own lifecycle envelope and paint opacity multiply
            // every entity's alpha, so a layer enters and leaves as one thing;
            // a textBlock's own opacity and a morph's text pass on top.
            var alpha = SceneMotion.pulsedAlpha(of: entity, layer: layer, at: t)
                * (layer.life?.alpha(at: t * 1000) ?? 1) * layer.opacity
                * (layer.life?.alpha(at: t * 1000, entity: entity.order) ?? 1)
            if case .textBlock = sprite { alpha *= min(1, max(0, layer.textStyle?.opacity ?? 1)) }
            if let xf = layer.textCrossfade { alpha *= d.pass == 1 ? xf.aOut : xf.aIn }
            node.alpha = alpha
            let grow = SceneMotion.growScale(of: entity, at: t)
            var deg = SceneMotion.rotationDegrees(of: entity, at: t) + (layer.paint?.rotationDegrees ?? 0)
            // Streaks, and strokes that orient, point along the real heading.
            switch sprite {
            case .streak:
                deg += (SceneMotion.heading(of: entity, at: t, in: size, dim: dim, wrap: layer.wrap,
                                            parent: parentEntity) ?? 0) * 180 / .pi
            case .stroke(_, _, _, _, _, _, _, let orient) where orient:
                deg += (SceneMotion.heading(of: entity, at: t, in: size, dim: dim, wrap: layer.wrap,
                                            parent: parentEntity) ?? 0) * 180 / .pi
            default: break
            }
            // `flip`: a glyph mirrors to face a leftward heading.
            let mirror: CGFloat = layer.flip && entity.headingLeft
                && (entity.motionType == "drift" || entity.motionType == "wander") ? -1 : 1
            if let paint = layer.paint {
                let s = paint.scaleXY
                node.xScale = grow * s.x * mirror
                node.yScale = grow * s.y
            } else {
                node.xScale = grow * mirror
                node.yScale = grow
            }
            node.zRotation = -deg * .pi / 180
        }
    }
}

extension UIColor {
    convenience init(hexString: String) {
        let c = parseHexRGB(hexString)
        self.init(red: c.0, green: c.1, blue: c.2, alpha: 1)
    }
}
