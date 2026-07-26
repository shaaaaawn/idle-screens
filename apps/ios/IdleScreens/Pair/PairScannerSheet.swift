import SwiftUI
import VisionKit

/// Camera sheet that scans the TV's pairing QR. Falls back to a plain
/// explanation on hardware without Live Text support (and the simulator,
/// which has no camera) — manual code entry lives on the TV tab itself.
struct PairScannerSheet: View {
    let onCode: @MainActor (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                    QRScannerView { payload in
                        // Accept either the raw code or the full pairing URL.
                        if let url = URL(string: payload), let code = AppState.pairCode(from: url) {
                            onCode(code)
                        } else {
                            onCode(payload)
                        }
                    }
                } else {
                    ContentUnavailableView(
                        "Camera unavailable",
                        systemImage: "camera.on.rectangle",
                        description: Text("Scanning needs a device with a camera. Type the code from the TV instead.")
                    )
                }
            }
            .navigationTitle("Scan pairing code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}

/// Thin wrapper over VisionKit's DataScannerViewController, QR-only.
private struct QRScannerView: UIViewControllerRepresentable {
    let onScan: @MainActor (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .fast,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        try? scanner.startScanning()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onScan: onScan)
    }

    @MainActor
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onScan: @MainActor (String) -> Void
        private var delivered = false

        init(onScan: @escaping @MainActor (String) -> Void) {
            self.onScan = onScan
        }

        func dataScanner(
            _ dataScanner: DataScannerViewController,
            didAdd addedItems: [RecognizedItem],
            allItems: [RecognizedItem]
        ) {
            guard !delivered else { return }
            for item in addedItems {
                if case .barcode(let barcode) = item, let payload = barcode.payloadStringValue {
                    delivered = true
                    onScan(payload)
                    return
                }
            }
        }
    }
}
