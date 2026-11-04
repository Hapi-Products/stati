import SwiftUI

struct IPadSongReader: View {
    @Environment(AppStore.self) private var store
    let computerID: String
    let songID: String
    @State private var song: APIRecord?
    @State private var message = ""
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                if let song { Text(song.title).font(.title2.weight(.semibold)) }
                SongNotesSection(computerID: computerID, songID: songID, opensNotes: true)
                if let song { Text(song["text"].text).font(.title2).lineSpacing(10).textSelection(.enabled) }
                else if message.isEmpty { ProgressView("Opening song…") }
                NoticeView(text: message)
            }.padding(32).frame(maxWidth: 820, alignment: .leading).frame(maxWidth: .infinity)
        }.navigationTitle("Song").navigationBarTitleDisplayMode(.inline)
            .task(id: computerID + songID + store.accountEpoch.uuidString) {
                let epoch = store.accountEpoch, owner = store.me?.id
                song = nil; message = ""
                do { let result = try await store.api.request("/computers/" + computerID + "/songs/" + songID); try Task.checkCancellation(); guard owner != nil, owner == store.me?.id, epoch == store.accountEpoch else { return }; song = APIRecord(raw: result.fields); if let song { store.recents.opened(song: song, computerID: computerID) } }
                catch is CancellationError { }
                catch { if epoch == store.accountEpoch { message = error.localizedDescription } }
            }
    }
}
