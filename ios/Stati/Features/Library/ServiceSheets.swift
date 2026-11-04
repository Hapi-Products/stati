import SwiftUI

struct SongPicker: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let computerID: String
    let selected: (APIRecord) -> Void
    @State private var query = ""
    @State private var library: SongLibraryModel?
    private var songs: [APIRecord] { library?.items ?? [] }
    @State private var message = ""
    var body: some View {
        List { ForEach(songs) { song in Button { selected(song) } label: { SongRow(song: song).foregroundStyle(.primary) } }; NoticeView(text: library?.message ?? message); if library?.loading == true { ProgressView("Loading songs…") } }
            .navigationTitle("Add song").searchable(text: $query, prompt: "Search titles or lyrics")
            .toolbar { Button("Cancel") { dismiss() } }
            .task(id: store.accountEpoch.uuidString + computerID + query) {
                do { try await Task.sleep(for: .milliseconds(200)); if library == nil { library = SongLibraryModel(store: store) }; await library?.load(computerID: computerID, group: "", query: query) } catch { }
            }
    }
}
