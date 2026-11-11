import SwiftUI

struct IPadSongsView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let title: String
    let group: String
    @State private var library: SongLibraryModel?
    @State private var reader: ReaderPreferences?
    @State private var preview: SongGalleryRequest?
    @State private var query = ""
    @State private var searching = false
    @AppStorage("stati.reader.libraryLayout") private var libraryLayout = "saved"
    @AppStorage("stati.worship.songListAfterGridRestore") private var listMode = false
    private var songs: [APIRecord] { library?.items ?? [] }
    private var loading: Bool { library?.loading == true }
    private var message: String { library?.message ?? "" }
    private var sections: [SongAlphabet] { SongAlphabet.sections(songs) }
    private var showsGrid: Bool { searchTerm.isEmpty && !(libraryLayout == "list" || libraryLayout == "saved" && listMode) && !dynamicTypeSize.isAccessibilitySize && !songs.isEmpty }
    private var searchTerm: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var searchGroups: [SongSearchGroup] { SongSearchGroup.sections(songs, query: searchTerm) }
    private var orderedSongs: [APIRecord] { searchTerm.isEmpty ? sections.flatMap(\.songs) : searchGroups.flatMap(\.songs) }
    private var largePreviews: Bool { reader?.settings.largePreviews == true }
    private var requestKey: String { store.accountEpoch.uuidString + store.selectedComputer + group + query + String(store.catalogChangeRevision) }
    var body: some View {
        VStack(spacing: 0) {
            if showsGrid {
                IPadSongGrid(songs: orderedSongs, large: largePreviews, open: openSong)
                if loading { ProgressView("Loading songs…").padding(8) }
                if !message.isEmpty {
                    NoticeView(text: message).padding(12)
                    Button("Try again", systemImage: "arrow.clockwise") { Task { await load() } }.padding(8)
                }
            } else {
                songList
            }
        }
        .background(Color(.systemBackground))
        .navigationTitle(title).navigationBarTitleDisplayMode(.large)
        .searchable(text: $query, isPresented: $searching, placement: .toolbar, prompt: "Search songs and lyrics").searchToolbarBehavior(.minimize)
        .task(id: requestKey) { do { try await Task.sleep(for: .milliseconds(200)); await load()
            #if DEBUG && targetEnvironment(simulator)
            if NativeReview.route == "ipad-reader-dismiss", let song = orderedSongs.first {
                openSong(song); try await Task.sleep(for: .seconds(1)); preview = nil
            }
            #endif
        } catch { } }
        .refreshable { await load() }
        .fullScreenCover(item: $preview) { SongGalleryView(store: store, request: $0) }
        .onReceive(NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)) { _ in reader?.reload() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { reader?.reload() } }
        .onChange(of: store.accountEpoch) { library = nil; preview = nil; reader = ReaderPreferences(ownerID: store.me?.id ?? "") }
        .onChange(of: store.selectedComputer) { library = nil; preview = nil }
        .onAppear {
            if reader == nil { reader = ReaderPreferences(ownerID: store.me?.id ?? "") }
            #if DEBUG && targetEnvironment(simulator)
            let route = NativeReview.route ?? ""
            if ["ipad-browse-list", "ipad-browse-list-large"].contains(route) { listMode = true }
            else if route == "ipad-browse" { listMode = false }
            if route.hasPrefix("ipad-search") { query = "Holy"; searching = true }
            #endif
        }
    }
    private var songList: some View {
        List {
            if store.selectedComputer.isEmpty {
                ContentUnavailableView("Library unavailable", systemImage: "books.vertical", description: Text("An administrator needs to connect this account to the church library."))
            } else {
                if !searchTerm.isEmpty {
                    ForEach(searchGroups) { section in
                        Section { ForEach(section.songs) { song in songButton(song) { songRow(song) } } } header: { Text(section.name + " · " + section.matchLabel) }
                    }
                } else {
                    ForEach(sections) { section in
                        Section { ForEach(section.songs) { song in songButton(song) { songRow(song) } } } header: { Text(section.id).font(.headline).foregroundStyle(.primary) }
                            .sectionIndexLabel(section.id)
                    }
                }
                if loading { ProgressView("Loading songs…") }
                if !message.isEmpty { NoticeView(text: message); Button("Try again", systemImage: "arrow.clockwise") { Task { await load() } } }
                if !loading && songs.isEmpty && message.isEmpty { ContentUnavailableView(query.isEmpty ? "No songs in this folder" : "No matching songs", systemImage: "music.note", description: Text(query.isEmpty ? "Choose another folder or check the connected library." : "Try another title or lyric.")) }
            }
        }.listStyle(.insetGrouped).listSectionSpacing(.compact).listSectionIndexVisibility(.visible)
    }
    private func openSong(_ song: APIRecord) { preview = SongGalleryRequest(computerID: store.selectedComputer, songs: orderedSongs, selectedID: song.id) }
    private func songButton<Content: View>(_ song: APIRecord, @ViewBuilder content: () -> Content) -> some View {
        Button { openSong(song) } label: { content() }.buttonStyle(.plain).accessibilityLabel(song.title)
    }
    private func songRow(_ song: APIRecord) -> some View {
        HStack(spacing: 16) {
            SlidePreview(text: song["firstSlide"].text, large: largePreviews)
            VStack(alignment: .leading, spacing: 4) {
                Text(song.title).font(largePreviews ? .title3 : .body).foregroundStyle(.primary)
                if group.isEmpty && !song["groupName"].text.isEmpty { Text(song["groupName"].text).font(.footnote).foregroundStyle(Color.statiSecondary) }
            }
            Spacer()
        }.padding(.vertical, 4).contentShape(.rect)
    }
    private func load() async {
        if library == nil { library = SongLibraryModel(store: store) }
        await library?.load(computerID: store.selectedComputer, group: group, query: query)
    }
}
