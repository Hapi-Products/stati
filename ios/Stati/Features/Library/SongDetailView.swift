import SwiftUI

struct SongDetailView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    let computerID: String
    let songID: String
    var opensNotes = false
    @State private var song: APIRecord?
    @State private var action: SongActionSheet?
    @State private var groupName = ""
    @State private var message = ""
    @State private var deleting = false
    private var command: SongCommand? { store.songCommands.request(computerID: computerID, songID: songID) }
    private var requestKey: String { computerID + "/" + songID }
    private var busy: Bool { store.songCommands.busy.contains(requestKey) }
    private var blocked: Bool { command != nil || store.songCommands.needsRecovery || busy }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let title = song?.title ?? command?.songTitle, !title.isEmpty { Text(title).font(.title2.bold()) }
                if let song, !song["groupName"].text.isEmpty { Text(song["groupName"].text + " version").foregroundStyle(Color.statiSecondary) }
                if store.songCommands.needsRecovery {
                    Text("Your saved song requests could not be opened. The existing file has been kept. Read it before starting another copy or delete request.").foregroundStyle(Color.statiSecondary)
                    Button("Retry reading song requests") { store.songCommands.retryReading() }.frame(minHeight: 44)
                }
                if let command { SongCommandStatusView(command: command) }
                NoticeView(text: store.songCommands.errors[requestKey] ?? "")
                SongNotesSection(computerID: computerID, songID: songID, opensNotes: opensNotes)
                if let song {
                    Text(song["text"].text).font(.title3).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                } else if message.isEmpty { ProgressView("Opening lyrics…") }
                NoticeView(text: message)
            }.padding().frame(maxWidth: 760).frame(maxWidth: .infinity)
        }.navigationTitle("Song").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let song {
                Menu("Song actions", systemImage: "ellipsis") {
                    if store.canPlan { Button("Add to service", systemImage: "text.badge.plus") { action = .add } }
                    if store.isAdmin {
                        Button("Group version", systemImage: "doc.on.doc") { action = .clone }.disabled(blocked)
                        Button("Delete song", systemImage: "trash", role: .destructive) { deleting = true }.disabled(blocked)
                    }
                    ShareLink(item: song["text"].text, subject: Text(song.title)) { Label("Share lyrics", systemImage: "square.and.arrow.up") }
                }
            }
        }
        .confirmationDialog("Delete this song on the PC?", isPresented: $deleting, titleVisibility: .visible) {
            Button("Delete on PC", role: .destructive) { Task { await sendCommand(.archive) } }
        } message: { Text("A verified administrator in the updated PC app will move it into the recovery archive. Existing service references will show it as missing.") }
        .sheet(item: $action) { mode in
            if mode == .add, let song { AddSongToService(computerID: computerID, song: song) { action = nil } }
            else { NavigationStack { Form { TextField("Person or group", text: $groupName); Text("The PC creates a separate version and preserves the original.").foregroundStyle(Color.statiSecondary); Button("Create copy on PC") { Task { await sendCommand(.clone); action = nil } }.disabled(SongCommand.normalized(groupName).isEmpty || SongCommand.normalized(groupName).utf16.count > 80 || blocked) }.navigationTitle("Group version").toolbar { Button("Cancel") { action = nil } } } }
        }
        .task {
            do { song = APIRecord(raw: try await store.api.request("/computers/" + computerID + "/songs/" + songID).fields) }
            catch let error as APIError where error.status == 404 { message = "This song is no longer in the shared library." }
            catch { message = error.localizedDescription }
        }
        .task(id: command?.id) {
            guard let id = command?.id else { return }
            while !Task.isCancelled {
                if scenePhase == .active { await store.songCommands.check(id) }
                guard let current = command, current.id == id, !current.isTerminal else { return }
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
            }
        }
    }
    private func sendCommand(_ kind: SongCommand.Kind) async {
        guard let song, store.isAdmin, !blocked else { return }
        await store.songCommands.start(computerID: computerID, song: song, kind: kind, groupName: groupName)
    }
}
