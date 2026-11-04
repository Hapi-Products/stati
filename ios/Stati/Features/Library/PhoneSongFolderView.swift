import SwiftUI

struct PhoneSongFolderView: View {
    @Environment(AppStore.self) private var store
    let group: String
    @Binding var query: String
    @State private var library: SongLibraryModel?
    @State private var preview: SongGalleryRequest?
    private var songs: [APIRecord] { library?.items ?? [] }
    private var term: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    var body: some View {
        List {
            if term.isEmpty { ForEach(songs) { song in row(song) } }
            else {
                ForEach(SongSearchGroup.sections(songs, query: term)) { section in
                    Section { ForEach(section.songs) { song in row(song) } } header: { Text(section.matchLabel) }
                }
            }
            if library?.loading == true { ProgressView("Loading songs…") }
            if let text = library?.message, !text.isEmpty { NoticeView(text: text); Button("Try again", systemImage: "arrow.clockwise") { Task { await load() } } }
            if library?.loading == false && songs.isEmpty { ContentUnavailableView.search(text: term) }
        }.navigationTitle(group == "__generic__" ? "Songs" : group).navigationBarTitleDisplayMode(.inline)
            .task(id: store.accountEpoch.uuidString + store.selectedComputer + group + query + String(store.catalogChangeRevision)) { do { try await Task.sleep(for: .milliseconds(200)); await load() } catch { } }
            .refreshable { await load() }
            .fullScreenCover(item: $preview) { SongGalleryView(store: store, request: $0) }
    }
    private func row(_ song: APIRecord) -> some View {
        Button { preview = SongGalleryRequest(computerID: store.selectedComputer, songs: songs, selectedID: song.id) } label: { SongRow(song: song).foregroundStyle(.primary) }.buttonStyle(.plain)
    }
    private func load() async {
        if library == nil { library = SongLibraryModel(store: store) }
        await library?.load(computerID: store.selectedComputer, group: group, query: query)
    }
}
