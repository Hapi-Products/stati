import SwiftUI

struct SongCommentDetailView: View {
    @Environment(AppStore.self) private var store
    let commentID: String
    @State private var correction: APIRecord?
    @State private var images: [APIRecord] = []
    @State private var notes: [APIRecord] = []
    @State private var message = ""
    @State private var preview: FilePreviewRequest?
    @State private var generation = UUID()
    var body: some View {
        Form {
            if let correction {
                Section {
                    if let person = store.me { HStack(spacing: 10) { MemberAvatar(api: store.api, path: person["photoUrl"].text, initials: String(person["first_name"].text.prefix(1)), size: 28); Text(person.personName).font(.footnote) } }
                    Text(correction["message"].text).textSelection(.enabled)
                    Text(correction["status"].text == "complete" ? "Reviewed" : correction["status"].text == "in-progress" ? "In review" : "Sent for review").font(.footnote).foregroundStyle(Color.statiSecondary)
                }
                if !correction["quote"].text.isEmpty { Section("Selected lyrics") { Text(correction["quote"].text).textSelection(.enabled) } }
                if !correction["replacement"].text.isEmpty { Section("Suggested correction") { Text(correction["replacement"].text).textSelection(.enabled) } }
                if !images.isEmpty {
                    Section("Images") {
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                            ForEach(images) { image in
                                TaskImagePreview(file: readOnly(image), compact: false, open: { preview = FilePreviewRequest(items: images.compactMap { FilePreviewItem(record: $0, pathKey: "url") }, selectedID: image.id) }, remove: {})
                            }
                        }
                    }
                }
                if !notes.isEmpty { Section("Review notes") { ForEach(notes) { note in TaskCommentRow(note: note, remove: {}) } } }
            } else if message.isEmpty { ProgressView("Opening comment…") }
            if !message.isEmpty { NoticeView(text: message) }
        }.navigationTitle(correction?.title ?? "Comment").navigationBarTitleDisplayMode(.inline)
            .task(id: commentID + store.accountEpoch.uuidString) { await load() }
            .onChange(of: store.taskChangeRevision) { Task { await load() } }
            .refreshable { await load() }
            .fullScreenCover(item: $preview) { StatiFileViewer(request: $0) }
    }
    private func readOnly(_ file: APIRecord) -> APIRecord { var value = file; value["canRemove"] = .bool(false); return value }
    private func load() async {
        let epoch = store.accountEpoch, owner = store.me?.id, scope = UUID(); generation = scope
        do {
            let value = try await store.api.request("/song-comments/" + commentID)
            let files = try await store.api.request("/tasks/" + commentID + "/images")
            try Task.checkCancellation(); guard generation == scope, epoch == store.accountEpoch, owner != nil, owner == store.me?.id else { return }
            guard value["correction"]["id"].text == commentID else { throw APIError(status: 409, message: "The comment could not be verified.") }
            correction = APIRecord(raw: value["correction"].fields); images = files["images"].records; notes = value["notes"].records; message = ""
        } catch is CancellationError { }
        catch { if generation == scope, epoch == store.accountEpoch { correction = nil; images = []; notes = []; preview = nil; message = error.localizedDescription } }
    }
}
