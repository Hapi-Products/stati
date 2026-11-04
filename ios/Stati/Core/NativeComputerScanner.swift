import SwiftUI
import VisionKit

struct NativeComputerScanner: UIViewControllerRepresentable {
    let active: Bool
    let detected: (String) -> Void
    let failed: (String) -> Void
    func makeUIViewController(context: Context) -> ComputerScannerController {
        ComputerScannerController(detected: detected, failed: failed)
    }
    func updateUIViewController(_ controller: ComputerScannerController, context: Context) { controller.detected = detected; controller.failed = failed; controller.active = active; controller.updateScanning() }
    static func dismantleUIViewController(_ controller: ComputerScannerController, coordinator: ()) { controller.scanner.stopScanning(); controller.scanner.delegate = nil }
}

@MainActor final class ComputerScannerController: UIViewController, DataScannerViewControllerDelegate {
    let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced, recognizesMultipleItems: false, isHighFrameRateTrackingEnabled: false, isGuidanceEnabled: true, isHighlightingEnabled: true)
    var detected: (String) -> Void
    var failed: (String) -> Void
    var active = true
    init(detected: @escaping (String) -> Void, failed: @escaping (String) -> Void) { self.detected = detected; self.failed = failed; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("Use the scanner initializer") }
    override func viewDidLoad() {
        super.viewDidLoad(); addChild(scanner); scanner.view.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(scanner.view)
        NSLayoutConstraint.activate([scanner.view.leadingAnchor.constraint(equalTo: view.leadingAnchor), scanner.view.trailingAnchor.constraint(equalTo: view.trailingAnchor), scanner.view.topAnchor.constraint(equalTo: view.topAnchor), scanner.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)])
        scanner.didMove(toParent: self); scanner.delegate = self
    }
    override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated); updateScanning() }
    override func viewWillDisappear(_ animated: Bool) { scanner.stopScanning(); super.viewWillDisappear(animated) }
    func updateScanning() {
        guard isViewLoaded else { return }
        guard active, view.window != nil else { scanner.stopScanning(); return }
        guard !scanner.isScanning else { return }
        do { try scanner.startScanning() } catch { failed("The camera could not start. Enter the computer code below, or try again.") }
    }
    func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) { for item in addedItems { accept(item) } }
    func dataScanner(_ dataScanner: DataScannerViewController, didTapOn item: RecognizedItem) { accept(item) }
    func dataScanner(_ dataScanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) { failed("The scanner is unavailable. Enter the computer code below.") }
    private func accept(_ item: RecognizedItem) { if case .barcode(let barcode) = item, let value = barcode.payloadStringValue { detected(value) } }
}
