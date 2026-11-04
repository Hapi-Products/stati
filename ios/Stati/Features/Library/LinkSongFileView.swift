import SwiftUI

struct LinkSongFileView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let computerID: String
    let songID: String
    let linkedIDs: Set<String>
    let linked: () -> Void
    @State private var files: [APIRecord] = []
    @State private var cursor = ""
    @State private var loading = true
    @State private var message = ""
    @State private var request = UUID()
    @State private var selection: APIRecord?
    private var choices: [APIRecord] { files.filter { $0["canDelete"].flag && !$0["removalPending"].flag && !linkedIDs.contains($0.id) } }
    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(choices) { file in SongNoteRow(file: file) { selection = file }.disabled(selection != nil) }
                    if loading { ProgressView("Loading shared files…") }
                    if !loading && choices.isEmpty { Text("No available files in this page. Share a group file first, or load older files.").foregroundStyle(Color.statiSecondary) }
                    if !cursor.isEmpty { Button("Load older files") { request = UUID() }.disabled(loading || selection != nil) }
                } footer: { Text("Choose a file you shared, or one you manage as an administrator. The original shared file stays in Group files.").foregroundStyle(Color.statiSecondary) }
                if selection != nil { ProgressView("Linking to song…") }
                if !message.isEmpty { NoticeView(text: message); Button("Refresh files") { files = []; cursor = ""; request = UUID() }.disabled(loading || selection != nil) }
            }.navigationTitle("Link shared file").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(selection != nil) } }
                .interactiveDismissDisabled(selection != nil)
        }
        .task(id: request) { await load() }
        .task(id: selection?.id) {
            guard let file = selection else { return }
            do {
                _ = try await store.api.request("/group-materials/" + file.id + "/song-links", method: "POST", body: .object(["action": .string("link"), "computerId": .string(computerID), "songId": .string(songID)]))
                try Task.checkCancellation()
                linked(); dismiss()
            } catch is CancellationError { }
            catch { message = "The link was not confirmed. Check the song’s notes, or retry this same file. " + error.localizedDescription }
            selection = nil
        }
    }
    private func load() async {
        let scope = request
        loading = true; defer { if scope == request { loading = false } }
        let owner = store.me?.id
        do {
            let value = try await store.api.request("/group-materials" + (cursor.isEmpty ? "" : "?before=" + cursor.queryEncoded))
            try Task.checkCancellation()
            guard scope == request, owner != nil, owner == store.me?.id else { return }
            files += value["materials"].records.filter { row in !files.contains(where: { $0.id == row.id }) }
            cursor = value["nextCursor"].text; message = ""
        } catch is CancellationError { }
        catch { message = error.localizedDescription }
    }
}
