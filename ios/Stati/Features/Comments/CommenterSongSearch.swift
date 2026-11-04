import SwiftUI

struct CommenterSongSearch: View {
    @Environment(AppStore.self) private var store
    @State private var query = ""
    @State private var library: SongLibraryModel?
    @State private var comments: SongCommentsModel
    init(store: AppStore) { _comments = State(initialValue: SongCommentsModel(store: store)) }
    private var sections: [SongSearchGroup] { SongSearchGroup.sections(library?.items ?? [], query: query) }
    var body: some View {
        List {
            Section { ComputerPicker() }
            ForEach(sections) { section in
                Section(section.name) {
                    ForEach(section.songs) { song in
                        Button { Task { await comments.open(song.id) } } label: { SongRow(song: song).foregroundStyle(.primary) }.buttonStyle(.plain)
                    }
                }
            }
            if library?.loading == true { ProgressView("Loading songs…") }
            if let message = library?.message, !message.isEmpty { NoticeView(text: message) }
            if !comments.message.isEmpty { NoticeView(text: comments.message) }
            if library?.loading == false && library?.items.isEmpty == true { ContentUnavailableView.search(text: query) }
        }.navigationTitle("Songs").navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "Search songs or first lines")
            .task(id: store.accountEpoch.uuidString + store.selectedComputer + query + String(store.catalogChangeRevision)) {
                do { try await Task.sleep(for: .milliseconds(200)); if library == nil { library = SongLibraryModel(store: store) }; await library?.load(computerID: store.selectedComputer, group: "", query: query) } catch { }
            }
            .sheet(item: $comments.song) { song in SongCorrectionComposer(store: store, computerID: store.selectedComputer, song: song) }
    }
}
