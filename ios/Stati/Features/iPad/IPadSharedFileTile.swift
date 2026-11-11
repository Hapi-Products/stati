import SwiftUI
import PDFKit

struct IPadSharedFileTile: View {
    let store: AppStore
    let file: APIRecord
    var large = false
    var showsGroupName = true
    @State private var thumbnail: UIImage?
    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 5).fill(Color(.tertiarySystemFill))
                if let thumbnail {
                    Image(uiImage: thumbnail).resizable().scaledToFit()
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: WorshipPreviewGrid.height(large: large))
            .clipShape(.rect(cornerRadius: 5))
            .accessibilityHidden(true)
            Text(file.title).font(.subheadline).foregroundStyle(.primary).lineLimit(2).multilineTextAlignment(.center)
            if showsGroupName && !file["groupName"].text.isEmpty { Text(file["groupName"].text).font(.caption).foregroundStyle(Color.statiSecondary).lineLimit(2) }
        }.frame(maxWidth: .infinity, alignment: .top).contentShape(.rect)
            .task(id: file["fileUrl"].text + file["contentVersion"].text + store.accountEpoch.uuidString) {
                thumbnail = nil
                let epoch = store.accountEpoch, owner = store.me?.id
                guard !file["removalPending"].flag, let item = FilePreviewItem(record: file, pathKey: "fileUrl") else { thumbnail = nil; return }
                let key = store.resources.key(owner: epoch.uuidString, item: item)
                if let cached = store.resources.thumbnail(key) { thumbnail = cached; return }
                do {
                    let bytes = try await store.resources.bytes(key: key, filename: item.filename) { try await store.api.bytes(item.path) }
                    try Task.checkCancellation()
                    let image = await FileThumbnailRenderer.render(bytes)
                    guard owner != nil, owner == store.me?.id, epoch == store.accountEpoch, !Task.isCancelled else { return }
                    if let image { store.resources.thumbnail(image, key: key); thumbnail = image }
                } catch { }
            }
    }
}
