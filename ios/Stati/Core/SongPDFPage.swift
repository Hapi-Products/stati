import SwiftUI
import PDFKit
struct SongPDFPage: UIViewRepresentable {
    let document: PDFDocument
    let index: Int
    func makeUIView(context: Context) -> PDFView {
        let view = PDFView(); view.autoScales = true; view.displayMode = .singlePage; view.displaysPageBreaks = false; view.backgroundColor = .white
        view.document = document
        if let page = document.page(at: index) { view.go(to: page) }
        return view
    }
    func updateUIView(_ view: PDFView, context: Context) {
        if view.document !== document { view.document = document }
        if let page = document.page(at: index), view.currentPage !== page { view.go(to: page) }
    }
}
