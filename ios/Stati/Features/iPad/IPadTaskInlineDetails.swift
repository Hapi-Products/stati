import SwiftUI

struct IPadTaskInlineDetails: View {
    @Environment(AppStore.self) private var store
    let taskID: String
    let openDetails: () -> Void
    @State private var images: [APIRecord] = []
    @State private var notes: [APIRecord] = []
    @State private var loading = true
    @State private var message = ""
    @State private var preview: FilePreviewRequest?
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Divider()
            HStack { Text("Images").font(.subheadline.weight(.semibold)); Spacer(); Button("Manage images", action: openDetails).font(.footnote).frame(minHeight: 44) }
            if loading { ProgressView("Opening details…") }
            if !images.isEmpty {
                HStack(alignment: .top, spacing: 10) {
                    ForEach(images.prefix(2)) { image in TaskImagePreview(file: readOnly(image, key: "canRemove"), compact: true, open: { open(image) }, remove: { }).frame(maxWidth: .infinity) }
                }
            } else if !loading && message.isEmpty { Text("No images attached.").font(.footnote).foregroundStyle(Color.statiSecondary) }
            ForEach(notes.suffix(2)) { note in TaskCommentRow(note: readOnly(note, key: "canDelete"), remove: { }) }
            if !message.isEmpty { NoticeView(text: message) }
            Button("View details and \(notes.count) comments", action: openDetails).font(.footnote).frame(minHeight: 44)
        }
        .fullScreenCover(item: $preview) { StatiFileViewer(request: $0) }
        .task(id: taskID + store.accountEpoch.uuidString) {
            let epoch = store.accountEpoch, owner = store.me?.id
            loading = true; images = []; notes = []; message = ""
            defer { if epoch == store.accountEpoch { loading = false } }
            do {
                let result = try await store.api.request("/tasks/" + taskID)
                try Task.checkCancellation()
                guard epoch == store.accountEpoch, owner != nil, owner == store.me?.id else { return }
                guard result["task"]["id"].text == taskID else { throw APIError(status: 409, message: "These task details could not be verified. Reopen the task.") }
                images = result["images"].records; notes = result["notes"].records
            } catch is CancellationError { }
            catch { if epoch == store.accountEpoch { message = error.localizedDescription } }
        }
    }
    private func readOnly(_ record: APIRecord, key: String) -> APIRecord { var result = record; result[key] = .bool(false); return result }
    private func open(_ image: APIRecord) {
        let items = images.compactMap { FilePreviewItem(record: $0, pathKey: "url") }
        if let item = FilePreviewItem(record: image, pathKey: "url") { preview = FilePreviewRequest(items: items, selectedID: item.id) }
    }
}
