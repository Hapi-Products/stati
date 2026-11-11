import SwiftUI
import PDFKit

struct SongPageThumbnails: View {
    let pages: [String]
    let document: PDFDocument?
    let slideSize: SlideTextSize
    let selectedIndex: Int
    let select: (Int) -> Void
    let close: () -> Void

    private var count: Int { document?.pageCount ?? pages.count }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(document == nil ? "Slides" : "Pages")
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Button("Close page previews", systemImage: "xmark", action: close)
                    .labelStyle(.iconOnly)
                    .buttonStyle(.glass)
                    .frame(minWidth: 44, minHeight: 44)
            }
            .padding(.horizontal, 16)

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 16)], spacing: 18) {
                        ForEach(0..<count, id: \.self) { index in
                            Button {
                                select(index)
                            } label: {
                                VStack(spacing: 6) {
                                    thumbnail(index)
                                    Text("\(index + 1)")
                                        .font(.subheadline.monospacedDigit())
                                        .foregroundStyle(index == selectedIndex ? Color.accentColor : .secondary)
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
        .presentationCompactAdaptation(.sheet)
    }

    private func thumbnail(_ index: Int) -> some View {
        SongPageThumbnail(image: { render(index) })
            .aspectRatio(document == nil ? 16.0 / 9.0 : 1.05, contentMode: .fit)
            .background(.quaternary.opacity(0.55), in: .rect(cornerRadius: 8))
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(index == selectedIndex ? Color.accentColor : Color.clear, lineWidth: 2)
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
