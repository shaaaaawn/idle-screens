import XCTest
import UIKit
@testable import IdleScreens

/// The widget's tile images are decoded at tile size, never full size.
final class WidgetStillTests: XCTestCase {
    func testALinkCardDecodesSmall() throws {
        let card = UIGraphicsImageRenderer(size: CGSize(width: 1200, height: 630),
                                           format: { let f = UIGraphicsImageRendererFormat(); f.scale = 1; return f }())
            .jpegData(withCompressionQuality: 0.8) { ctx in
                UIColor.systemTeal.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 1200, height: 630))
            }
        let still = try XCTUnwrap(TileStill.downsampled(card, maxPixels: 400))
        XCTAssertEqual(max(still.size.width * still.scale, still.size.height * still.scale), 400, accuracy: 1)
        XCTAssertEqual(still.size.width / still.size.height, 1200.0 / 630.0, accuracy: 0.02)
    }

    func testNotAnImageIsAMiss() {
        XCTAssertNil(TileStill.downsampled(Data("<svg/>".utf8), maxPixels: 400))
    }
}
