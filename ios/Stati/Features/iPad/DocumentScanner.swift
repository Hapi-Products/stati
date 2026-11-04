import SwiftUI
import VisionKit

struct DocumentScanner: UIViewControllerRepresentable {
    let finished: (Result<Data?, Error>) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(finished: finished) }
    func makeUIViewController(context: Context) -> VNDocumentCameraViewController { let view = VNDocumentCameraViewController(); view.delegate = context.coordinator; return view }
    func updateUIViewController(_ controller: VNDocumentCameraViewController, context: Context) { }
    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let finished: (Result<Data?, Error>) -> Void
        init(finished: @escaping (Result<Data?, Error>) -> Void) { self.finished = finished }
        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) { finished(.success(nil)) }
        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: any Error) { finished(.failure(error)) }
        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            guard (1...20).contains(scan.pageCount) else { finished(.failure(GroupScanStorage.failure("Scan up to 20 pages at a time."))); return }
            let data = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792)).pdfData { context in
                for index in 0..<scan.pageCount {
                    context.beginPage()
                    let image = scan.imageOfPage(at: index)
                    let factor = min(1, 1800 / max(image.size.width, image.size.height))
                    let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
                    let small = UIGraphicsImageRenderer(size: CGSize(width: image.size.width * factor, height: image.size.height * factor), format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: CGSize(width: image.size.width * factor, height: image.size.height * factor))) }
                    let page = small.jpegData(compressionQuality: 0.8).flatMap(UIImage.init(data:)) ?? small
                    let ratio = min(572 / page.size.width, 752 / page.size.height)
                    let size = CGSize(width: page.size.width * ratio, height: page.size.height * ratio)
                    page.draw(in: CGRect(x: (612 - size.width) / 2, y: (792 - size.height) / 2, width: size.width, height: size.height))
                }
            }
            guard data.count <= 12 * 1024 * 1024 else { finished(.failure(GroupScanStorage.failure("This scan is larger than 12 MB. Try scanning fewer pages."))); return }
            finished(.success(data))
        }
    }
}
