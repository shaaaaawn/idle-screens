import OSLog
import SpriteKit
import SwiftUI

private let skLog = Logger(subsystem: "com.hermosalabs.idlescreens", category: "sprite-scene")

/// GPU renderer for compiled scenes — the t2 tier. Textured SpriteKit nodes
/// driven by the same SceneMotion math as the Canvas renderer, so the two
/// tiers agree frame-for-frame on placement. Built for the A8 / A10X floor,
/// where per-frame CPU rasterization (SwiftUI Canvas) cannot hold a frame
/// rate: textures are baked once at build, then each frame only moves nodes.
/// Bonus over the Canvas tier: true additive blending (`.add`) and pre-baked
/// soft-glow textures, i.e. the web engine's `lighter` look for free.
struct SpriteSceneView: UIViewRepresentable {
    let layers: [CompiledLayer]
    let background: SpecSubset.Background?

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> SKView {
        let view = SKView()
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
        if let scene = view.scene as? CompiledSpriteScene, scene.matches(layers) {
            return  // same scene data — keep animating, no rebuild
        }
        let scene = CompiledSpriteScene(layers: layers, background: background)
        scene.scaleMode = .resizeFill
        view.presentScene(scene)
    }
}

final class CompiledSpriteScene: SKScene {
    /// Total on-screen node budget. SpriteKit on A8 comfortably animates
    /// hundreds of textured quads at 1080p; thin by stride above this.
    private static let nodeBudget = 500

    private let layersData: [CompiledLayer]
    private let bg: SpecSubset.Background?
    /// nodes[layerIndex] parallels entities kept after thinning, paired with
    /// the entity that drives it.
    private var driven: [(node: SKSpriteNode, entity: CompiledEntity, layer: Int)] = []
    private var textures: [String: SKTexture] = [:]
    private var startTime: TimeInterval?
    private var builtForSize: CGSize = .zero

    init(layers: [CompiledLayer], background: SpecSubset.Background?) {
        self.layersData = layers
        self.bg = background
        super.init(size: .zero)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("unused") }

    func matches(_ layers: [CompiledLayer]) -> Bool { layersData == layers }

    override func didMove(to view: SKView) {
        backgroundColor = .black
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
        buildBackground()
        buildNodes()
        skLog.notice("built \(self.driven.count) nodes at \(self.size.width)x\(self.size.height) scene=\(ObjectIdentifier(self).debugDescription)")
    }

    // MARK: - Build

    private func buildBackground() {
        let node = SKSpriteNode(texture: backgroundTexture())
        node.size = size
        node.position = CGPoint(x: size.width / 2, y: size.height / 2)
        node.zPosition = -1
        addChild(node)
    }

    private func backgroundTexture() -> SKTexture {
        // 1pt-wide vertical strip, stretched by the node — cheap and smooth.
        let h = max(2, Int(size.height / 4))
        let img = UIGraphicsImageRenderer(size: CGSize(width: 1, height: CGFloat(h))).image { ctx in
            let cg = ctx.cgContext
            if let stops = bg?.stops, !stops.isEmpty {
                let colors = stops.map { UIColor(hexString: $0.color).cgColor } as CFArray
                let locations = stops.map { CGFloat(min(1, max(0, $0.at))) }
                if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                                             colors: colors, locations: locations) {
                    cg.drawLinearGradient(gradient, start: .zero,
                                          end: CGPoint(x: 0, y: h), options: [])
                }
            } else {
                UIColor(hexString: bg?.color ?? "000000").setFill()
                cg.fill(CGRect(x: 0, y: 0, width: 1, height: h))
            }
        }
        return SKTexture(image: img)
    }

    private func buildNodes() {
        let total = layersData.reduce(0) { $0 + $1.entities.count }
        let stride = max(1, Int((Double(total) / Double(Self.nodeBudget)).rounded(.up)))
        for (li, layer) in layersData.enumerated() {
            let dim = layer.units == .px ? 1 : min(size.width, size.height)
            for (i, entity) in layer.entities.enumerated() {
                if stride > 1, i % stride != 0 { continue }
                guard let node = makeNode(entity: entity, layer: layer, dim: dim) else { continue }
                node.zPosition = CGFloat(li)
                switch layer.blend {
                case "lighter": node.blendMode = .add
                case "screen": node.blendMode = .screen
                case "multiply": node.blendMode = .multiply
                default: node.blendMode = .alpha
                }
                addChild(node)
                driven.append((node, entity, li))
            }
        }
    }

    private func makeNode(entity: CompiledEntity, layer: CompiledLayer,
                          dim: CGFloat) -> SKSpriteNode? {
        let defaultWidth = layer.units == .px ? 2.0 : 0.002
        switch layer.sprite {
        case .circle(_, _, _, let soft):
            let r = entity.size * dim
            guard r > 0.25 else { return nil }  // sub-pixel content: skip
            let node = SKSpriteNode(texture: circleTexture(color: entity.color, soft: soft))
            node.size = CGSize(width: r * 2, height: r * 2)
            return node

        case .ring(_, _, _, let width):
            let r = entity.size * dim
            guard r > 0.25 else { return nil }
            let node = SKSpriteNode(texture: ringTexture(
                color: entity.color,
                widthRatio: min(1, max(0.01, ((width ?? defaultWidth) * dim) / r))))
            node.size = CGSize(width: r * 2, height: r * 2)
            return node

        case .rect:
            let w = entity.size * dim
            guard w > 0.25 else { return nil }
            let node = SKSpriteNode(color: UIColor(hexString: entity.color), size:
                CGSize(width: w, height: w * entity.aspect))
            return node

        case .streak(_, _, _, let width):
            let length = entity.size * dim
            let speed = hypot(entity.vx, entity.vy)
            guard length > 0.25, speed > 0 else { return nil }
            let node = SKSpriteNode(color: UIColor(hexString: entity.color), size:
                CGSize(width: length, height: max(0.5, (width ?? defaultWidth) * dim)))
            // Streak heading is fixed per entity (velocity direction).
            // SpriteKit y is flipped relative to the compile space.
            node.zRotation = atan2(-entity.vy, entity.vx)
            node.anchorPoint = CGPoint(x: 1, y: 0.5)  // trail behind the head
            return node

        case .emoji, .text:
            guard let glyph = entity.glyph, entity.size > 0.5 else { return nil }
            let node = SKSpriteNode(texture: glyphTexture(
                glyph: glyph, size: entity.size, color: entity.color))
            return node

        case .textBlock(let text, let maxWidth, let fontSize, let lineHeight,
                        let align, let color, _):
            let fsPx = fontSize * dim
            guard fsPx > 1 else { return nil }
            let node = SKSpriteNode(texture: textBlockTexture(
                text: text, maxWidth: maxWidth, fontSize: fontSize,
                lineHeight: lineHeight, align: align, color: color, dim: dim))
            node.anchorPoint = CGPoint(x: 0, y: 1)
            return node

        case .unknown:
            return nil
        }
    }

    // MARK: - Texture cache

    private func texture(key: String, _ make: () -> UIImage) -> SKTexture {
        if let cached = textures[key] { return cached }
        let tex = SKTexture(image: make())
        textures[key] = tex
        return tex
    }

    private func circleTexture(color: String, soft: Bool) -> SKTexture {
        texture(key: "c|\(color)|\(soft)") {
            let d: CGFloat = 128
            return UIGraphicsImageRenderer(size: CGSize(width: d, height: d)).image { ctx in
                let cg = ctx.cgContext
                let ui = UIColor(hexString: color)
                if soft {
                    // Web-parity falloff (compile.ts): bright core to 35% of
                    // the radius, then fade to transparent.
                    let colors = [ui.cgColor,
                                  ui.withAlphaComponent(0.75).cgColor,
                                  ui.withAlphaComponent(0).cgColor] as CFArray
                    if let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                                          colors: colors, locations: [0, 0.35, 1]) {
                        cg.drawRadialGradient(
                            g, startCenter: CGPoint(x: d / 2, y: d / 2), startRadius: 0,
                            endCenter: CGPoint(x: d / 2, y: d / 2), endRadius: d / 2,
                            options: [])
                    }
                } else {
                    ui.setFill()
                    cg.fillEllipse(in: CGRect(x: 0, y: 0, width: d, height: d))
                }
            }
        }
    }

    private func ringTexture(color: String, widthRatio: CGFloat) -> SKTexture {
        // Quantize the stroke ratio so similar rings share one texture.
        let q = (widthRatio * 32).rounded() / 32
        return texture(key: "r|\(color)|\(q)") {
            let d: CGFloat = 128
            return UIGraphicsImageRenderer(size: CGSize(width: d, height: d)).image { ctx in
                let cg = ctx.cgContext
                let lw = max(1, q * d / 2)
                UIColor(hexString: color).setStroke()
                cg.setLineWidth(lw)
                cg.strokeEllipse(in: CGRect(x: lw / 2, y: lw / 2,
                                            width: d - lw, height: d - lw))
            }
        }
    }

    private func textBlockTexture(text: String, maxWidth: Double, fontSize: Double,
                                      lineHeight: Double, align: String,
                                      color: String, dim: CGFloat) -> SKTexture {
        let fsPx = fontSize * dim
        let lh = lineHeight * fsPx
        let maxWPx = maxWidth * dim
        let maxWEm = maxWPx / fsPx
        let lines = breakTextBlock(text: text, maxWidthEm: maxWEm)
        let totalH = max(1, CGFloat(lines.count) * lh)
        let canvasW = ceil(max(1, maxWPx))
        let canvasH = ceil(totalH)
        let key = "tb|\(text.hashValue)|\(Int(fsPx))|\(Int(canvasW))|\(align)|\(color)"
        return texture(key: key) {
            UIGraphicsImageRenderer(size: CGSize(width: canvasW, height: canvasH)).image { _ in
                let attrs: [NSAttributedString.Key: Any] = [
                    .font: UIFont.systemFont(ofSize: fsPx),
                    .foregroundColor: UIColor(hexString: color),
                ]
                for (i, line) in lines.enumerated() {
                    let y = CGFloat(i) * lh
                    let ns = line.text as NSString
                    let sz = ns.size(withAttributes: attrs)
                    let x: CGFloat
                    switch align {
                    case "center": x = (maxWPx - sz.width) / 2
                    case "right": x = maxWPx - sz.width
                    default: x = 0
                    }
                    ns.draw(at: CGPoint(x: x, y: y), withAttributes: attrs)
                }
            }
        }
    }

    private func glyphTexture(glyph: String, size: CGFloat, color: String) -> SKTexture {
        texture(key: "g|\(glyph)|\(Int(size))|\(color)") {
            let font = UIFont.systemFont(ofSize: size)
            let attrs: [NSAttributedString.Key: Any] = [
                .font: font, .foregroundColor: UIColor(hexString: color),
            ]
            let bounds = (glyph as NSString).size(withAttributes: attrs)
            let canvas = CGSize(width: ceil(max(1, bounds.width)),
                                height: ceil(max(1, bounds.height)))
            return UIGraphicsImageRenderer(size: canvas).image { _ in
                (glyph as NSString).draw(at: .zero, withAttributes: attrs)
            }
        }
    }

    // MARK: - Frame update

    override func update(_ currentTime: TimeInterval) {
        let start = startTime ?? currentTime
        if startTime == nil {
            startTime = start
            skLog.notice("first tick scene=\(ObjectIdentifier(self).debugDescription)")
        }
        let t = currentTime - start

        for (node, entity, li) in driven {
            let layer = layersData[li]
            let dim = layer.units == .px ? 1 : min(size.width, size.height)
            let p = SceneMotion.position(of: entity, at: t, in: size,
                                         dim: dim, wrap: layer.wrap)
            // Compile space is top-left y-down; SpriteKit is bottom-left y-up.
            node.position = CGPoint(x: p.x, y: size.height - p.y)
            node.alpha = SceneMotion.pulsedAlpha(of: entity, layer: layer, at: t)
            let grow = SceneMotion.growScale(of: entity, at: t)
            if grow != 1 { node.setScale(grow) }
            let deg = SceneMotion.rotationDegrees(of: entity, at: t)
            if deg != 0 { node.zRotation = -deg * .pi / 180 }
        }
    }
}

extension UIColor {
    convenience init(hexString: String) {
        let hex = hexString.trimmingCharacters(in: .alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        self.init(
            red: CGFloat((int >> 16) & 0xFF) / 255,
            green: CGFloat((int >> 8) & 0xFF) / 255,
            blue: CGFloat(int & 0xFF) / 255,
            alpha: 1)
    }
}
