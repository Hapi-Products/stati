import AppIntents
import SwiftUI

struct SongShortcutRequest: Identifiable {
    let id = UUID()
    let query: String
    var destination: Destination = .songs

    enum Destination { case songs, services, recents }
}

@MainActor @Observable
final class SongShortcutNavigation {
    static let shared = SongShortcutNavigation()
    var request: SongShortcutRequest?
}

enum StatiShortcutError: LocalizedError {
    case disabled

    var errorDescription: String? { "Turn on Siri Shortcuts in Settings to use this Stați action." }

    @MainActor static func open(_ request: SongShortcutRequest) throws {
        guard UserDefaults.standard.object(forKey: "stati.shortcuts.enabled") as? Bool ?? true else { throw Self.disabled }
        SongShortcutNavigation.shared.request = request
    }
}

struct FindStatiSong: AppIntent {
    static let title: LocalizedStringResource = "Find a Song"
    static let description = IntentDescription("Find a song by its title or part of the lyrics and show matching songs in the Stați library.")
    static let openAppWhenRun = true
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication

    @Parameter(title: "Song title or lyrics")
    var query: String

    static var parameterSummary: some ParameterSummary {
        Summary("Find \(\.$query)")
    }

    @MainActor func perform() async throws -> some IntentResult {
        try StatiShortcutError.open(SongShortcutRequest(query: String(query.prefix(200))))
        return .result()
    }
}

struct BrowseStatiSongs: AppIntent {
    static let title: LocalizedStringResource = "Browse Songs"
    static let openAppWhenRun = true
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication

    @MainActor func perform() async throws -> some IntentResult {
        try StatiShortcutError.open(SongShortcutRequest(query: ""))
        return .result()
    }
}

struct OpenStatiRecents: AppIntent {
    static let title: LocalizedStringResource = "Show Recent Songs"
    static let openAppWhenRun = true
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication

    @MainActor func perform() async throws -> some IntentResult {
        try StatiShortcutError.open(SongShortcutRequest(query: "", destination: .recents))
        return .result()
    }
}

struct OpenStatiServices: AppIntent {
    static let title: LocalizedStringResource = "Show Services"
    static let openAppWhenRun = true
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication

    @MainActor func perform() async throws -> some IntentResult {
        try StatiShortcutError.open(SongShortcutRequest(query: "", destination: .services))
        return .result()
    }
}

struct StatiShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: FindStatiSong(),
            phrases: ["Find a song in \(.applicationName)", "Open a song in \(.applicationName)"],
            shortTitle: "Find a Song",
            systemImageName: "music.note"
        )
        AppShortcut(
            intent: BrowseStatiSongs(),
            phrases: ["Browse songs in \(.applicationName)", "Show all songs in \(.applicationName)"],
            shortTitle: "Browse Songs",
            systemImageName: "music.note.list"
        )
        AppShortcut(intent: OpenStatiServices(), phrases: ["Show services in \(.applicationName)"], shortTitle: "Services", systemImageName: "calendar")
        AppShortcut(intent: OpenStatiRecents(), phrases: ["Show recent songs in \(.applicationName)"], shortTitle: "Recent Songs", systemImageName: "clock")
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
            didSearch = false
            if library == nil { library = SongLibraryModel(store: store) }
            do {
                try await Task.sleep(for: .milliseconds(250))
                await search()
            } catch { }
        }
        .onChange(of: store.accountEpoch) { dismiss() }
        .onChange(of: store.canReadSongs) { _, allowed in if !allowed { dismiss() } }
        .fullScreenCover(item: $selection) { SongGalleryView(store: store, request: $0) }
    }

    private func search() async {
        guard store.canReadSongs, let library, !store.selectedComputer.isEmpty else {
            didSearch = true
            return
        }
        let input = query, computer = store.selectedComputer, epoch = store.accountEpoch
        await library.load(computerID: computer, group: "", query: input, includeText: false)
        guard !Task.isCancelled, input == query, computer == store.selectedComputer, epoch == store.accountEpoch else { return }
        didSearch = true
    }

    private func open(_ song: APIRecord) {
        selection = SongGalleryRequest(computerID: store.selectedComputer, songs: results, selectedID: song.id)
    }
}

struct SongShortcutDestination: View {
    let store: AppStore
    let request: SongShortcutRequest
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Group {
            switch request.destination {
            case .songs:
                SongShortcutView(store: store, request: request)
            case .services, .recents:
                NavigationStack {
                    Group {
                        if request.destination == .services {
                            IPadServicesView().navigationDestination(for: IPadSidebarRoute.self) { route in
                                if case .service(let id) = route {
                                    ServiceRouteView(computerID: store.selectedComputer, serviceID: id)
                                }
                            }
                        } else {
                            IPadRecentsView(active: true)
                        }
                    }
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Close", systemImage: "xmark") { dismiss() }.labelStyle(.iconOnly)
                        }
                    }
                }
            }
        }
        .onChange(of: store.accountEpoch) { dismiss() }
        .onChange(of: store.canReadSongs) { _, allowed in if !allowed { dismiss() } }
    }
}
