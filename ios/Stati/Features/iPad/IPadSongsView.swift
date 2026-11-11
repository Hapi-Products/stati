import SwiftUI

struct IPadSongsView: View {
    @Environment(AppStore.self) private var store
    let title: String
    let group: String
    @State private var library: SongLibraryModel?
    @State private var currentSong: SongGalleryRequest?
    @State private var selectedID: String?
    @State private var selectionScope: String?
    @State private var showsLibrary = false
    @State private var query = ""

    private var songs: [APIRecord] { library?.items ?? [] }
    private var searchTerm: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var scope: String { [store.accountEpoch.uuidString, store.selectedComputer, group].joined(separator: "|") }
    private var requestKey: String { [scope, searchTerm, String(store.catalogChangeRevision)].joined(separator: "|") }
    private var orderedSongs: [APIRecord] {
        if searchTerm.isEmpty { SongAlphabet.sections(songs).flatMap(\.songs) }
        else { SongSearchGroup.sections(songs, query: searchTerm).flatMap(\.songs) }
    }

    var body: some View {
        Group {
            if selectionScope == scope, let currentSong {
                SongGalleryView(store: store, request: currentSong, openLibrary: { showsLibrary = true }) {
                    selectedID = $0
                }
                .id(currentSong.id)
            } else {
                emptyReader
            }
        }
        .sheet(isPresented: $showsLibrary) {
            libraryPanel.presentationSizing(.form)
        }
        .onChange(of: scope) {
            currentSong = nil
            selectedID = nil
            selectionScope = nil
            showsLibrary = false
            query = ""
        }
        .task(id: requestKey) {
            do { try await Task.sleep(for: .milliseconds(180)) } catch { return }
            await load()
            guard !Task.isCancelled, currentSong == nil, searchTerm.isEmpty else { return }
            let available = orderedSongs
            let ids = Set(available.map(\.id))
            let recent = store.recents.items.first {
                $0.kind == .song && $0.computerID == store.selectedComputer && ids.contains($0.itemID)
            }
            if let song = available.first(where: { $0.id == recent?.itemID }) ?? available.first {
                open(song)
            }
        }
        #if DEBUG && targetEnvironment(simulator)
        .onAppear {
            if ["ipad-worship-library", "ipad-browse-list", "ipad-browse-list-large"].contains(NativeReview.route ?? "") {
                showsLibrary = true
            }
            if NativeReview.route?.hasPrefix("ipad-search") == true {
                showsLibrary = true
                query = "Holy"
            }
        }
        #endif
    }

    private var emptyReader: some View {
        ContentUnavailableView {
            Label("Songs", systemImage: "music.note")
        } description: {
            Text(store.selectedComputer.isEmpty
                 ? "Connect to a church computer to open its songs."
                 : "Choose a song from Stați Cloud.")
        } actions: {
            Button("Open Library", systemImage: "books.vertical") { showsLibrary = true }
                .buttonStyle(.glassProminent)
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Library", systemImage: "books.vertical") { showsLibrary = true }
            }
        }
    }

    private var libraryPanel: some View {
        NavigationStack {
            List {
                if let message = library?.message, !message.isEmpty {
                    NoticeView(text: message)
                }
                if library?.loading == true { ProgressView("Loading songs…") }
                if searchTerm.isEmpty {
                    ForEach(SongAlphabet.sections(songs)) { section in
                        Section(section.id) { ForEach(section.songs, content: row) }
                            .sectionIndexLabel(section.id)
                    }
                } else {
                    ForEach(SongSearchGroup.sections(songs, query: searchTerm)) { section in
                        Section(section.name + " · " + section.matchLabel) {
                            ForEach(section.songs, content: row)
                        }
                    }
                }
                if songs.isEmpty, library?.loading != true {
                    ContentUnavailableView(
                        searchTerm.isEmpty ? "No songs available" : "No matching songs",
                        systemImage: searchTerm.isEmpty ? "music.note" : "magnifyingglass"
                    )
                }
            }
            .listStyle(.insetGrouped)
            .listSectionIndexVisibility(.visible)
            .navigationTitle(group.isEmpty || group == "__generic__" ? "Stați Cloud" : title)
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search songs or lyrics")
            .refreshable { await load() }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close library", systemImage: "xmark") { showsLibrary = false }
                        .labelStyle(.iconOnly)
                }
            }
        }
    }

    private func row(_ song: APIRecord) -> some View {
        Button {
            open(song)
            showsLibrary = false
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "music.note")
                    .foregroundStyle(.tint)
                    .frame(width: 24)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(song.title).foregroundStyle(.primary)
                    if !song["groupName"].text.isEmpty {
                        Text(song["groupName"].text).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
                if selectedID == song.id {
                    Image(systemName: "checkmark").foregroundStyle(.tint).accessibilityHidden(true)
                }
            }
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selectedID == song.id ? .isSelected : [])
    }

    private func open(_ song: APIRecord) {
        guard selectionScope != scope || selectedID != song.id else { return }
        selectionScope = scope
        currentSong = SongGalleryRequest(computerID: store.selectedComputer, songs: orderedSongs, selectedID: song.id)
        selectedID = currentSong?.position.selectedID
    }

    private func load() async {
        if library == nil { library = SongLibraryModel(store: store) }
        await library?.load(computerID: store.selectedComputer, group: group, query: searchTerm)
    }
}
