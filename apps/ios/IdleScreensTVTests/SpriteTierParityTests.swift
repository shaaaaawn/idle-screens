import SpriteKit
import XCTest
@testable import IdleScreensTV

/// The sprite tier (pre-4K boxes) against the Canvas tier's rules.
@MainActor
final class SpriteTierParityTests: XCTestCase {

    private func present(_ json: String) throws -> CompiledSpriteScene {
        let spec = try JSONDecoder().decode(SpecSubset.self, from: Data(json.utf8))
        let view = SKView(frame: CGRect(x: 0, y: 0, width: 1920, height: 1080))
        let scene = CompiledSpriteScene(layers: spec.compile(seed: 1), background: spec.background)
        scene.size = view.frame.size
        view.presentScene(scene)
        objc_setAssociatedObject(scene, "host", view, .OBJC_ASSOCIATION_RETAIN)
        return scene
    }

    func testACentreAnchoredCaptionCentresOnItsPosition() throws {
        // `default`'s era caption: anchor centre, align centre.
        let scene = try present(##"{"layers":[{"count":1,"position":{"x":0.5,"y":0.5},"motion":{"type":"static"},"sprite":{"kind":"textBlock","text":"1999 · digital rain","maxWidth":1.2,"fontSize":0.026,"lineHeight":1.2,"align":"center","anchor":"center","color":"#ffffff"}}]}"##)
        let node = try XCTUnwrap(scene.children.compactMap { $0 as? SKSpriteNode }.first { $0.zPosition == 0 })
        XCTAssertEqual(node.anchorPoint.x, 0.5, accuracy: 0.01, "centred ink on a centred box")
        XCTAssertEqual(node.anchorPoint.y, 0.5, accuracy: 0.01)
    }

    func testAnUnanchoredTextBlockStaysTopLeft() throws {
        let scene = try present(##"{"layers":[{"count":1,"position":{"x":0.1,"y":0.1},"motion":{"type":"static"},"sprite":{"kind":"textBlock","text":"title","maxWidth":0.8,"fontSize":0.03,"color":"#ffffff"}}]}"##)
        let node = try XCTUnwrap(scene.children.compactMap { $0 as? SKSpriteNode }.first { $0.zPosition == 0 })
        XCTAssertEqual(node.anchorPoint, CGPoint(x: 0, y: 1))
    }

    func testAFieldGroundIsItsKeyBandNotBlack() throws {
        let scene = try present(##"{"background":{"type":"field","bands":["#030010","#0a0326","#3a0b5c","#3a0b5c","#14062e"]},"layers":[{"count":1,"sprite":{"kind":"circle","radius":[0.01,0.01],"color":"#fff"},"motion":{"type":"static"}}]}"##)
        let ground = try XCTUnwrap(scene.children.compactMap { $0 as? SKSpriteNode }.first { $0.zPosition == -1 })
        let image = try XCTUnwrap(ground.texture?.cgImage())
        var px = [UInt8](repeating: 0, count: 4)
        let ctx = try XCTUnwrap(CGContext(data: &px, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                                          space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        XCTAssertGreaterThan(Int(px[0]) + Int(px[2]), 60, "the middle band (#3a0b5c), not black")
    }
}
