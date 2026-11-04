import UIKit
import PDFKit

nonisolated enum FileThumbnailRenderer {
    @concurrent static func render(_ data: Data) async -> UIImage? {
        if let image = PreviewImage.decode(data, maximumPixels: 384) { return image }
        guard let pdf = PDFDocument(data: data), let page = pdf.page(at: 0) else { return nil }
        return page.thumbnail(of: CGSize(width: 176, height: 152), for: .mediaBox)
    }
}
