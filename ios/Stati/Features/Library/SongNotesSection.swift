import SwiftUI

struct SongNotesSection: View {
    @Environment(AppStore.self) private var store
    let computerID: String
    let songID: String
    let opensNotes: Bool
    @State private var files: [APIRecord] = []
    @State private var nextCursor = ""
    @State private var loading = true
    @State private var loaded = false
    @State private var message = ""
    @State private var request = UUID()
    @State private var more = false
    @State private var autoOpened = false
    @State private var choosing = false
    @State private var linking = false
    @State private var opening: APIRecord?
    @State private var afterDismiss: APIRecord?
    @State private var preview: FilePreviewRequest?
    @State private var removing: APIRecord?
    @State private var unlinkID: String?
    init(computerID: String, songID: String, opensNotes: Bool) {
        self.computerID = computerID; self.songID = songID; self.opensNotes = opensNotes
        #if DEBUG && targetEnvironment(simulator)
        if NativeReview.route == "song-notes-link" { _linking = State(initialValue: true) }
        #endif
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Shared notes").font(.headline)
                Spacer()
                if store.canPlan {
                    Button("Link shared file", systemImage: "link") { linking = true }
                        .labelStyle(ActionIconLabelStyle()).frame(minWidth: 44, minHeight: 44)
                        .disabled(loading || unlinkID != nil)
                }
            }
            if loading { ProgressView("Loading song notes…") }
            if opening != nil { ProgressView("Opening shared notes…") }
            if loaded && files.isEmpty && message.isEmpty { Text("No shared notes linked. Lyrics are below.").font(.footnote).foregroundStyle(Color.statiSecondary) }
            ForEach(files) { file in
                HStack {
                    SongNoteRow(file: file) { open(file) }
                    if store.canPlan && file["canDelete"].flag {
                        Menu("Notes actions", systemImage: "ellipsis") {
                            Button("Unlink from song", systemImage: "link", role: .destructive) { removing = file }
                        }.labelStyle(ActionIconLabelStyle()).frame(minWidth: 44, minHeight: 44).disabled(unlinkID != nil)
                    }
                }
            }
            if !nextCursor.isEmpty { Button("Load more notes") { reload(more: true) }.frame(minHeight: 44).disabled(loading) }
            if !message.isEmpty {
                NoticeView(text: message)
                Button("Check notes again", systemImage: "arrow.clockwise") { reload() }.frame(minHeight: 44).disabled(loading)
            }
            if unlinkID != nil { ProgressView("Updating song notes…") }
        }
        .task(id: computerID + songID + (store.me?.id ?? "") + request.uuidString) { await load() }
        .onChange(of: opening) { _, file in
            guard let file else { return }
            preview = FilePreviewRequest(record: file, pathKey: "fileUrl")
            if preview == nil { message = "This file link is unavailable. Check song notes again." }
            opening = nil
        }
        .task(id: unlinkID) {
            guard let id = unlinkID else { return }
            do {
                _ = try await store.api.request("/group-materials/" + id + "/song-links", method: "POST", body: .object(["action": .string("unlink"), "computerId": .string(computerID), "songId": .string(songID)]))
                try Task.checkCancellation()
                reload()
            } catch is CancellationError { }
            catch { message = "The link change was not confirmed. Check song notes before trying again. " + error.localizedDescription }
            unlinkID = nil
        }
        .fullScreenCover(item: $preview) { StatiFileViewer(request: $0) }
        .sheet(isPresented: $linking) { LinkSongFileView(computerID: computerID, songID: songID, linkedIDs: Set(files.map(\.id))) { reload() } }
        .sheet(isPresented: $choosing, onDismiss: { if let file = afterDismiss { afterDismiss = nil; opening = file } }) {
            NavigationStack {
                List {
                    ForEach(files) { file in SongNoteRow(file: file) { open(file) } }
                    if loading { ProgressView("Loading song notes…") }
                    if !nextCursor.isEmpty { Button("Load more notes") { reload(more: true) }.disabled(loading) }
                    NoticeView(text: message)
                }.navigationTitle("Song notes").navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("View lyrics") { choosing = false } } }
            }
        }
        .confirmationDialog("Unlink these notes?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            if let removing { Button("Unlink from song", role: .destructive) { unlinkID = removing.id; self.removing = nil } }
        } message: { Text("The shared group file stays available. Only its link to this song is removed.") }
    }
    private func open(_ file: APIRecord) {
        guard opening == nil, !file["removalPending"].flag else { return }
        message = ""
        if choosing { afterDismiss = file; choosing = false } else { opening = file }
    }
    private func reload(more: Bool = false) { self.more = more; request = UUID() }
    private func load() async {
        let scope = request, append = more, owner = store.me?.id, cursor = more ? nextCursor : ""
        loading = true; message = ""
        defer { if scope == request { loading = false } }
        do {
            let result = try await store.api.request("/group-materials?computerId=" + computerID.queryEncoded + "&songId=" + songID.queryEncoded + (cursor.isEmpty ? "" : "&before=" + cursor.queryEncoded))
            try Task.checkCancellation()
            guard scope == request, owner != nil, owner == store.me?.id else { return }
            let page = try SongNotesPage(result, computerID: computerID, songID: songID)
            files = append ? files + page.files.filter { next in !files.contains(where: { $0.id == next.id }) } : page.files
            nextCursor = page.nextCursor; loaded = true
            if opensNotes && !autoOpened {
                autoOpened = true
                if let file = page.automaticFile { opening = file }
                else if !files.isEmpty || !nextCursor.isEmpty { choosing = true }
            }
        } catch is CancellationError { }
        catch { message = error.localizedDescription }
    }
}
