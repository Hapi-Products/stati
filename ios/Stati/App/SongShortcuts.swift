import AppIntents
import SwiftUI

struct SongShortcutRequest: Identifiable {
    let id = UUID()
    let query: String
}

@MainActor @Observable
final class SongShortcutNavigation {
    static let shared = SongShortcutNavigation()
    var request: SongShortcutRequest?
}

struct FindStatiSong: AppIntent {
    static let title: LocalizedStringResource = "Open Song"
    static let description = IntentDescription("Find a song by its title or part of the lyrics and open it in Stați.")
    static let openAppWhenRun = true
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication

    @Parameter(title: "Song title or lyrics")
    var query: String

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$query)")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        SongShortcutNavigation.shared.request = SongShortcutRequest(query: String(query.prefix(200)))
        return .result()
    }
}

struct BrowseStatiSongs: AppIntent {
    static let title: LocalizedStringResource = "Browse Songs"
    static let openAppWhenRun = true
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication

    @MainActor
    func perform() async throws -> some IntentResult {
        SongShortcutNavigation.shared.request = SongShortcutRequest(query: "")
        return .result()
    }
}

struct StatiShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: FindStatiSong(),
            phrases: ["Find a song in \(.applicationName)", "Open a song in \(.applicationName)"],
            shortTitle: "Open Song",
            systemImageName: "music.note"
        )
        AppShortcut(
            intent: BrowseStatiSongs(),
            phrases: ["Browse songs in \(.applicationName)", "Show all songs in \(.applicationName)"],
            shortTitle: "Browse Songs",
            systemImageName: "music.note.list"
        )
    }
}

struct SongShortcutView: View {
    let store: AppStore
    let request: SongShortcutRequest
    @Environment(\.dismiss) private var dismiss
    @State private var library: SongLibraryModel?
    @State private var selection: SongGalleryRequest?
    @State private var query: String
    @State private var didSearch = false
    @State private var firstLookup = true
    @State private var composing = false
    @State private var message = ""

    init(store: AppStore, request: SongShortcutRequest) {
        self.store = store
        self.request = request
        _query = State(initialValue: request.query)
    }

    private var results: [APIRecord] {
        (library?.items ?? []).sorted {
            let order = $0.title.localizedStandardCompare($1.title)
            return order == .orderedSame ? $0.id < $1.id : order == .orderedAscending
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if store.selectedComputer.isEmpty { ComputerPicker() }
                if !didSearch || library?.loading == true { ProgressView("Finding songs…") }
                else if results.isEmpty {
                    ContentUnavailableView("No matching songs", systemImage: "music.note", description: Text(library?.message ?? "Try a title or part of the lyrics."))
                }
                if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Button("Find hymns online", systemImage: "globe") { composing = true }
                }
                ForEach(results) { song in
                    Button { open(song) } label: { SongRow(song: song).foregroundStyle(.primary) }
                        .buttonStyle(.plain)
                }
            }
            .navigationTitle("Songs")
            .searchable(text: $query, prompt: "Title or lyrics")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }.labelStyle(.iconOnly)
                }
            }
        }
        .task(id: query + "|" + store.selectedComputer) {
            let autoOpen = firstLookup && query == request.query
            didSearch = false
            if library == nil { library = SongLibraryModel(store: store) }
            do {
                if !autoOpen { try await Task.sleep(for: .milliseconds(250)) }
                await search(autoOpen: autoOpen)
            } catch { }
        }
        .sheet(isPresented: $composing) {
            SongTextComposer(preparing: false, message: message, add: queueDraft, onlineQuery: query)
                .environment(store)
        }
        .onChange(of: store.accountEpoch) { dismiss() }
        .onChange(of: store.canReadSongs) { _, allowed in if !allowed { dismiss() } }
        .fullScreenCover(item: $selection) { SongGalleryView(store: store, request: $0) }
    }

    private func search(autoOpen: Bool) async {
        guard store.canReadSongs, let library, !store.selectedComputer.isEmpty else {
            didSearch = true
            return
        }
        let input = query, computer = store.selectedComputer, epoch = store.accountEpoch
        await library.load(computerID: computer, group: "", query: input, includeText: false)
        guard !Task.isCancelled, input == query, computer == store.selectedComputer, epoch == store.accountEpoch else { return }
        didSearch = true
        firstLookup = false
        if autoOpen, !input.isEmpty, let song = SongSearchGroup.directMatch(results, query: input) { open(song) }
    }

    private func queueDraft() async -> Bool {
        guard let owner = store.me?.id, !store.selectedComputer.isEmpty else { return false }
        let draft = store.sendDraft, computer = store.selectedComputer
        do {
            try await FileStager.stage(count: 1, queue: store.uploads) { _ in
                try await UploadFiles.prepareSongText(draft, userID: owner, deviceID: computer)
            }
            if store.me?.id == owner, store.sendDraft == draft { store.sendDraft = SendDraft() }
            message = ""
            return true
        } catch {
            message = error.localizedDescription
            return false
        }
    }

    private func open(_ song: APIRecord) {
        selection = SongGalleryRequest(computerID: store.selectedComputer, songs: results, selectedID: song.id)
    }
}
