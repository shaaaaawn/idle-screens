import ImageIO
import UIKit

/// A channel still for a widget tile.
enum TileStill {
    /// Decode at tile size, never at full size: a 1200×630 card is ~3 MB as a
    /// bitmap, and nine of them at once would crowd a widget's small memory
    /// limit. ImageIO builds the small image without the big one.
    static func downsampled(_ data: Data, maxPixels: Int) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceThumbnailMaxPixelSize: maxPixels,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceShouldCacheImmediately: true,
              ] as CFDictionary)
        else { return nil }
        return UIImage(cgImage: image)
    }
}
