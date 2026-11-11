import SwiftUI
import PDFKit

struct SongPageThumbnails: View {
    let pages: [String]
    let document: PDFDocument?
    let slideSize: SlideTextSize
    let selectedIndex: Int
    let select: (Int) -> Void
    @AppStorage("reader.thumbnailWidth") private var thumbnailWidth = 220.0
    private var accent: Color { AppIconAppearance.shared.accent }

    private var count: Int { document?.pageCount ?? pages.count }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "square.grid.3x3").accessibilityHidden(true)
                Slider(value: $thumbnailWidth, in: 130...300, step: 10)
                    .accessibilityLabel("Preview size")
                Image(systemName: "square.grid.2x2").accessibilityHidden(true)
            }
            .foregroundStyle(.secondary)
            .tint(accent)
            .padding(.horizontal, 16)
            .padding(.top, 10)

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: thumbnailWidth), spacing: 16)], spacing: 18) {
                        ForEach(0..<count, id: \.self) { index in
                            Button {
                                select(index)
                            } label: {
                                VStack(spacing: 6) {
                                    thumbnail(index)
                                    Text("\(index + 1)")
                                        .font(.subheadline.monospacedDigit())
                                        .foregroundStyle(index == selectedIndex ? accent : .secondary)
                                }
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(document == nil ? "Slide" : "Page") \(index + 1)")
                            .accessibilityAddTraits(index == selectedIndex ? .isSelected : [])
                            .id(index)
                        }
                    }
                    .padding(16)
                }
                .defaultScrollAnchor(.top)
                .task { proxy.scrollTo(selectedIndex, anchor: .center) }
            }
        }
        .frame(idealWidth: 600, idealHeight: 505)
        .presentationCompactAdaptation(.popover)
    }

    private func thumbnail(_ index: Int) -> some View {
        SongPageThumbnail(image: { render(index) })
            .aspectRatio(document == nil ? 16.0 / 9.0 : 1.05, contentMode: .fit)
            .background(.quaternary.opacity(0.55), in: .rect(cornerRadius: 8))
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(index == selectedIndex ? accent : Color.clear, lineWidth: 2)
            }
            .accessibilityHidden(true)
    }

    private func render(_ index: Int) -> UIImage? {
        if let document {
            return document.page(at: index)?.thumbnail(of: CGSize(width: 460, height: 590), for: .cropBox)
        }
        guard pages.indices.contains(index) else { return nil }
        let text = pages[index]
        let ending = text.components(separatedBy: "\n").last?
            .trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
            .lowercased()
        let view = SongSlidePage(
            text: text, size: slideSize,
            isEnding: index == pages.count - 1 && (ending == "amen" || ending == "amin")
        )
        .frame(width: 1280, height: 720)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 0.5
        return renderer.uiImage
    }
}

private struct SongPageThumbnail: View {
    let image: () -> UIImage?
    @State private var preview: UIImage?

    var body: some View {
        GeometryReader { geometry in
            if let preview {
                Image(uiImage: preview)
                    .resizable()
                    .scaledToFit()
                    .frame(width: geometry.size.width, height: geometry.size.height)
            }
        }
        .clipShape(.rect(cornerRadius: 8))
        .task { preview = image() }
    }
}
