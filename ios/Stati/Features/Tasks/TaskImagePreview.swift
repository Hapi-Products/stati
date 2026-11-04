import SwiftUI

struct TaskImagePreview: View {
    @Environment(AppStore.self) private var store
    let file: APIRecord
    let compact: Bool
    let open: () -> Void
    let remove: () -> Void
    @State private var image: UIImage?
    @State private var loading = true
    @State private var failed = false
    var body: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: 6) {
                Group {
                    if let image { Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: .infinity, maxHeight: compact ? 120 : 180) }
                    else if loading { ProgressView("Loading image…").frame(maxWidth: .infinity, minHeight: 80) }
                    else { Label("Open image", systemImage: "photo").frame(maxWidth: .infinity, minHeight: 60) }
                }
                Text(file["filename"].text).font(.footnote).foregroundStyle(Color.statiSecondary).lineLimit(2)
                if failed { Text("Preview unavailable. Tap to try opening it again.").font(.footnote).foregroundStyle(Color.statiSecondary).lineLimit(2) }
            }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open image, " + file["filename"].text)
        .contextMenu {
            Button("Open image", systemImage: "arrow.up.right.square", action: open)
            if file["canRemove"].flag { Button("Remove image", systemImage: "trash", role: .destructive, action: remove) }
        }
        .task(id: file["url"].text + file["sha256"].text + (store.me?.id ?? "")) {
            image = nil; loading = true; failed = false
            let owner = store.me?.id, epoch = store.accountEpoch
            do {
                let data = try await store.api.bytes(file["url"].text)
                try Task.checkCancellation()
                guard owner != nil, owner == store.me?.id, epoch == store.accountEpoch else { return }
                guard let decoded = PreviewImage.decode(data, maximumPixels: 768) else { throw APIError(status: 0, message: "The image preview could not be opened.") }
                image = decoded
            } catch is CancellationError { }
            catch { failed = true }
            loading = false
        }
    }
}
