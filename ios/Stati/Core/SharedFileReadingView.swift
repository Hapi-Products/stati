import SwiftUI
import PDFKit

struct SharedFileReadingView: View {
    let document: PDFDocument?
    let image: UIImage?
    let transition: ReaderTransition
    @Binding var page: Int
    @Binding var inverted: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showPages = false

    var body: some View {
        Group {
            if let document, document.pageCount > 0 {
                SongPageHost(pages: [], document: document, index: $page,
                             effect: transition.effective(reduceMotion: reduceMotion),
                             clickerEnabled: true, inverted: inverted)
                    .id(inverted)
                    .safeAreaInset(edge: .bottom) {
                        ReaderPagingBar(index: page, count: document.pageCount,
                                        previous: { page -= 1 }, next: { page += 1 }, pageLabels: true,
                                        showPagePreviews: { showPages = true }, previewPresented: $showPages) {
                            SongPageThumbnails(pages: [], document: document, slideSize: .large,
                                               selectedIndex: page, inverted: inverted) {
                                page = $0
                                showPages = false
                            }
                        }
                    }
            } else if let image {
                ZoomableFileImage(image: image)
                    .colorInverted(inverted)
                    .background(inverted ? .black : Color(uiColor: .systemBackground))
            }
        }
    }
}
