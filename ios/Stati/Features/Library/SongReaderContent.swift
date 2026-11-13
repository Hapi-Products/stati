import SwiftUI
import PDFKit

struct SongReaderContent: View {
    let song: APIRecord
    let mode: SongReaderMode
    let transition: ReaderTransition
    let clickerEnabled: Bool
    var pdfColumns: PDFColumnCount = .one
    var slideSize: SlideTextSize = .large
    var showsPagingControls = true
    var guide: WorshipGuide?
    @ScaledMetric(relativeTo: .title) private var readingTextSize = 32.0
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Binding var pageIndex: Int
    var followsLeader = false
    private var index: Int { min(max(0, pageIndex), max(0, count - 1)) }
    private var pageSelection: Binding<Int> { Binding(get: { index }, set: { pageIndex = $0 }) }
    @State private var showsPagePreviews = false
    @State private var document: PDFDocument?
    @State private var failure = ""
    private var pages: [String] {
        let songPages = SongPages(text: song["text"].text)
        return mode == .slides ? songPages.slides : songPages.pages
    }
    private var count: Int { mode == .document ? document?.pageCount ?? 0 : pages.count }
    var body: some View {
        Group {
            if mode == .text {
                ScrollView { Text(song["text"].text).font(.system(size: readingTextSize)).lineSpacing(8).textSelection(.enabled).padding(.horizontal, 28).padding(.vertical, 12).frame(maxWidth: 820, alignment: .leading).frame(maxWidth: .infinity, alignment: .center) }
            } else if count > 0 {
                SongPageHost(pages: pages, document: mode == .document ? document : nil, index: pageSelection, effect: transition.effective(for: mode, reduceMotion: reduceMotion), clickerEnabled: clickerEnabled, slideSize: slideSize, allowsNavigation: !followsLeader)
                    .id(mode.rawValue + transition.effective(for: mode, reduceMotion: reduceMotion).rawValue + String(slideSize.sliderPosition) + String(pdfColumns.rawValue) + String(colorScheme == .dark))
                    .safeAreaInset(edge: .bottom) {
                        if showsPagingControls {
                            ReaderPagingBar(
                                index: index, count: count, disabled: followsLeader,
                                previous: { move(-1) }, next: { move(1) },
                                pageLabels: true,
                                showPagePreviews: count > 1 ? {
                                    guide?.stop()
                                    showsPagePreviews = true
                                } : nil,
                                guide: guide,
                                previewPresented: $showsPagePreviews,
                                previews: {
                                    SongPageThumbnails(
                                        pages: pages,
                                        document: mode == .document ? document : nil,
                                        slideSize: slideSize,
                                        selectedIndex: index
                                    ) { target in
                                        guard (0..<count).contains(target) else { return }
                                        pageIndex = target
                                        showsPagePreviews = false
                                    }
                                }
                            )

                        }
                    }
            } else if !failure.isEmpty { ContentUnavailableView("Document unavailable", systemImage: "doc", description: Text(failure)) }
            else if pages.isEmpty { ContentUnavailableView("No lyrics available", systemImage: "music.note") }
            else { ProgressView("Preparing document…") }
        }.frame(maxWidth: .infinity, maxHeight: .infinity).background(mode == .slides ? Color.black : Color(.systemBackground))
            .task(id: song.id + song["contentHash"].text + String(pdfColumns.rawValue) + mode.rawValue + String(colorScheme == .dark)) { if mode == .document { prepareDocument() } }
            .onChange(of: mode) { showsPagePreviews = false }
            #if DEBUG && targetEnvironment(simulator)
            .onAppear {
                if NativeReview.route == "reader-slides-last" { pageIndex = max(0, count - 1) }
            }
            .task(id: count) {
                guard NativeReview.route == "reader-page-thumbnails", count > 1 else { return }
                do { try await Task.sleep(for: .milliseconds(700)) } catch { return }
                showsPagePreviews = true
            }
            #endif
    }
    private func move(_ by: Int) { guard (0..<count).contains(index + by) else { return }; pageIndex = index + by }
    private func prepareDocument() {
        do {
            let traits = UITraitCollection(userInterfaceStyle: colorScheme == .dark ? .dark : .light)
            let bytes = try SongDocumentRenderer.document(text: song["text"].text, columns: pdfColumns,
                foreground: UIColor.label.resolvedColor(with: traits),
                background: UIColor.systemBackground.resolvedColor(with: traits))
            guard let value = PDFDocument(data: bytes), value.pageCount > 0 else { throw APIError(status: 409, message: "Reopen the song and try again.") }
            document = value; failure = ""
            #if DEBUG && targetEnvironment(simulator)
            if NativeReview.route == "reader-middle" { pageIndex = min(1, count - 1) }
            if NativeReview.route == "reader-last" { pageIndex = max(0, count - 1) }
            #endif
        } catch { failure = error.localizedDescription }
    }
}
