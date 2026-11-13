import PDFKit
import SwiftUI

struct LiveClickerPreview: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var colorScheme
    let live: LiveClicker.Connection
    let computer: String
    let retry: Int
    @State private var source: Source?
    @State private var render: Render?
    @State private var unavailable = false

    private struct Source {
        let key: String
        let lyrics: String
    }

    private struct Render {
        let key: String
        var slides: [String] = []
        var pdf: PDFDocument?
    }

    private var sourceKey: String { computer + "/" + live.songID + "/" + live.contentHash }
    private var renderKey: String { sourceKey + "/\(live.mode.rawValue)/\(live.columns.rawValue)/\(colorScheme)" }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Label("Live page", systemImage: "rectangle.on.rectangle")
                .font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
            page
                .frame(maxWidth: .infinity)
                .clipShape(.rect(cornerRadius: 18))
                .overlay { RoundedRectangle(cornerRadius: 18).strokeBorder(.quaternary) }
        }
        .task(id: sourceKey + "/\(retry)") { if source?.key != sourceKey { await load() } }
        .task(id: renderKey + (source?.key == sourceKey ? "/loaded" : "")) { prepare() }
    }

    @ViewBuilder private var page: some View {
        if let render, render.key == renderKey {
            if let pdf = render.pdf, pdf.page(at: live.page) != nil {
                SongPDFPage(document: pdf, index: live.page)
                    .aspectRatio(612.0 / 792, contentMode: .fit)
                    .allowsHitTesting(false)
                    .accessibilityLabel("PDF preview, page \(live.page + 1)")
            } else if render.slides.indices.contains(live.page) {
                slide(render.slides[live.page], isLast: live.page == render.slides.count - 1)
            } else {
                placeholder("Preview unavailable", symbol: "rectangle.slash")
            }
        } else if unavailable || live.songID.isEmpty {
            placeholder("Preview unavailable", symbol: "rectangle.slash")
        } else {
            ProgressView("Loading live page…")
                .frame(maxWidth: .infinity).frame(height: 190).background(.background)
        }
    }

    private func slide(_ text: String, isLast: Bool) -> some View {
        let ending = text.components(separatedBy: "\n").last?
            .trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters)).lowercased()
        return GeometryReader { geometry in
            SongSlidePage(text: text, size: live.size, isEnding: isLast && ["amen", "amin"].contains(ending ?? ""))
                .frame(width: 1024, height: 576)
                .scaleEffect(geometry.size.width / 1024, anchor: .topLeading)
                .frame(width: geometry.size.width, height: geometry.size.height, alignment: .topLeading)
        }
        .aspectRatio(16.0 / 9, contentMode: .fit)
        .background(.black)
    }

    private func placeholder(_ message: String, symbol: String) -> some View {
        Label(message, systemImage: symbol).font(.subheadline).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity).frame(height: 190).background(.background)
    }

    private func load() async {
        let key = sourceKey
        unavailable = false
        guard live.songID.utf8.count == 64, live.songID.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              !computer.isEmpty else { unavailable = true; return }
        do {
            let song = try await store.api.request("/computers/" + computer + "/songs/" + live.songID)
            guard !Task.isCancelled, store.selectedComputer == computer else { return }
            guard song["contentHash"].text == live.contentHash else { unavailable = true; return }
            source = Source(key: key, lyrics: song["text"].text)
        } catch {
            if !Task.isCancelled { unavailable = true }
        }
    }

    private func prepare() {
        guard let source, source.key == sourceKey else { return }
        let key = renderKey
        switch live.mode {
        case .slides:
            render = Render(key: key, slides: SongPages(text: source.lyrics).slides)
        case .document:
            let traits = UITraitCollection(userInterfaceStyle: colorScheme == .dark ? .dark : .light)
            let bytes = try? SongDocumentRenderer.document(text: source.lyrics, columns: live.columns,
                foreground: UIColor.label.resolvedColor(with: traits), background: UIColor.systemBackground.resolvedColor(with: traits))
            render = Render(key: key, pdf: bytes.flatMap(PDFDocument.init(data:)))
        case .text:
            render = Render(key: key)
        }
    }
}
