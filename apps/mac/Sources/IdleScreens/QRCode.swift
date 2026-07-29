import AppKit
import CoreImage

/// QR images for pairing links and channel URLs — so a phone can point its
/// camera at the Mac instead of retyping a six-character code.
enum QRCode {
  /// A crisp QR at `size` points. CIQRCodeGenerator emits ~25×25 px, so it's
  /// scaled with a transform rather than by the image view (nearest-neighbour
  /// on the CIImage keeps the modules hard-edged; view scaling blurs them into
  /// something a camera struggles with).
  static func image(for text: String, size: CGFloat = 180) -> NSImage? {
    guard !text.isEmpty,
      let filter = CIFilter(name: "CIQRCodeGenerator")
    else { return nil }
    filter.setValue(Data(text.utf8), forKey: "inputMessage")
    // M: 15% recovery — enough for a screen, and keeps the modules large.
    filter.setValue("M", forKey: "inputCorrectionLevel")
    guard let output = filter.outputImage else { return nil }

    let scale = size / output.extent.width
    let scaled = output.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    let rep = NSCIImageRep(ciImage: scaled)
    let image = NSImage(size: rep.size)
    image.addRepresentation(rep)
    return image
  }

  /// Decode a QR back out of an image. Used by the tests to prove the code we
  /// render is the code a camera would read — the only headless check that
  /// actually exercises the encoder.
  static func decode(_ image: NSImage) -> String? {
    guard let tiff = image.tiffRepresentation,
      let ciImage = CIImage(data: tiff)
    else { return nil }
    let detector = CIDetector(
      ofType: CIDetectorTypeQRCode, context: nil,
      options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])
    let features = detector?.features(in: ciImage) as? [CIQRCodeFeature]
    return features?.compactMap(\.messageString).first
  }
}
