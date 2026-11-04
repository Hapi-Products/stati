import SwiftUI

struct LibraryView: View {
    @Environment(AppStore.self) private var store
    @Binding var area: String
    @Binding var query: String
    @State private var group = ""
    @State private var library: SongLibraryModel?
    private var groups: [String] { library?.groups ?? [] }
    private var songs: [APIRecord] { library?.items ?? [] }
    private var searchGroups: [SongSearchGroup] { SongSearchGroup.sections(songs, query: searchTerm) }
    private var total: Int { library?.total ?? 0 }
    @State private var services: [APIRecord] = []
    @State private var loading = false
    @State private var message = ""
    @State private var creating = false
    @State private var preview: SongGalleryRequest?
    init(query: Binding<String>, area: Binding<String>) { _query = query; _area = area }
    private var searchTerm: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var matchingServices: [APIRecord] {
        services.filter { !$0["archived"].flag && (searchTerm.isEmpty || [$0.title, $0["notes"].text, $0["date"].text].contains(where: { $0.localizedStandardContains(searchTerm) })) }
    }
    var body: some View {
        VStack(spacing: 0) {
            Picker("Workspace", selection: $area) { Text("Songs").tag("songs"); Text("Services").tag("services"); Text("Group files").tag("groups") }
                .pickerStyle(.segmented).frame(minHeight: 44).padding(.horizontal, 16)
            if area == "groups" { GroupFilesView(query: query) }
            else { List {
            Section { ComputerPicker() }
            if store.selectedComputer.isEmpty { ContentUnavailableView("Connect to a computer", systemImage: "desktopcomputer", description: Text("Choose an approved church computer to browse its saved library.")) }
            else if loading && area == "services" { ProgressView("Loading…") }
            else if area == "songs" {
                if searchTerm.isEmpty && !groups.isEmpty {
                    Section {
                        DisclosureGroup("Song groups") {
                            NavigationLink(value: LibraryRoute.folder("__generic__")) { Label("Songs", systemImage: "folder") }
                            ForEach(groups.filter { !$0.isEmpty && $0 != "__generic__" }, id: \.self) { name in NavigationLink(value: LibraryRoute.folder(name)) { Label(name, systemImage: "folder") } }
                        }
                    }
                }
                if !searchTerm.isEmpty {
                    ForEach(searchGroups) { section in
                        Section {
                            ForEach(section.songs) { song in songButton(song) }
                        } header: { Text(section.name + " · " + section.matchLabel) }
                    }
                }
                Section {
                    if searchTerm.isEmpty { ForEach(songs) { song in songButton(song) } }
                    if library?.loading == true { ProgressView("Loading songs…") }
                    if let text = library?.message, !text.isEmpty { NoticeView(text: text); Button("Try again") { Task { await load() } } }
                } header: { if searchTerm.isEmpty { SectionHeading("\(total) \(total == 1 ? "song" : "songs")") } }
                if songs.isEmpty && library?.loading != true { ContentUnavailableView.search(text: query) }
            } else {
                Section {
                    if matchingServices.isEmpty { ContentUnavailableView(searchTerm.isEmpty ? "No services yet" : "No matching services", systemImage: "calendar", description: Text(searchTerm.isEmpty ? "Create a service to prepare its running order." : "Try another title, date or note.")) }
                    ForEach(matchingServices) { plan in
                        NavigationLink(value: LibraryRoute.service(plan.id)) {
                            VStack(alignment: .leading, spacing: 5) { Text(plan.title).font(.headline); Text(plan["date"].text + " · " + plan["time"].text + " · \(plan["songs"].items.count) songs").font(.footnote).foregroundStyle(Color.statiSecondary) }
                        }
                    }
                    if store.canPlan { Button("New service", systemImage: "plus") { creating = true } }
                }
            }
            if !message.isEmpty { Section { NoticeView(text: message) } }
            } }
        }
        .navigationTitle(area == "services" ? "Services" : area == "groups" ? "Group files" : "Songs")
        .navigationDestination(for: LibraryRoute.self) { route in
            switch route {
            case .song(let id): SongDetailView(computerID: store.selectedComputer, songID: id, opensNotes: reviewOpensNotes)
            case .service(let id): ServiceRouteView(computerID: store.selectedComputer, serviceID: id)
            case .folder(let name): PhoneSongFolderView(group: name, query: $query)
            }
        }
        .fullScreenCover(item: $preview) { SongGalleryView(store: store, request: $0) }
        .sheet(isPresented: $creating) { NewServiceView(computerID: store.selectedComputer) { creating = false; Task { await load() } } }
        .refreshable { await load() }
        .task(id: store.accountEpoch.uuidString + store.selectedComputer + ":" + area + ":" + group + ":" + query + ":" + String(area == "services" ? store.serviceChangeRevision : store.catalogChangeRevision)) { do { try await Task.sleep(for: .milliseconds(200)); await load() } catch { } }
    }
    private func songButton(_ song: APIRecord) -> some View {
        Button { preview = SongGalleryRequest(computerID: store.selectedComputer, songs: songs, selectedID: song.id) } label: { SongRow(song: song).foregroundStyle(.primary) }.buttonStyle(.plain).draggable(song.id)
    }
    private var reviewOpensNotes: Bool {
        #if DEBUG && targetEnvironment(simulator)
        NativeReview.route == "song-notes-single-auto" || NativeReview.route == "song-notes-file-preview" || NativeReview.route == "song-notes-multiple"
        #else
        false
        #endif
    }
    private func load() async {
        guard !store.selectedComputer.isEmpty, area != "groups" else { return }
        let epoch = store.accountEpoch, computer = store.selectedComputer
        if area == "songs" {
            if library == nil { library = SongLibraryModel(store: store) }
            await library?.load(computerID: computer, group: group, query: query)
        } else {
            loading = true; defer { if epoch == store.accountEpoch { loading = false } }
            do { let result = try await store.api.request("/computers/" + computer + "/services"); guard epoch == store.accountEpoch, computer == store.selectedComputer else { return }; services = result["plans"].records; message = "" }
            catch is CancellationError { }
            catch { if epoch == store.accountEpoch { message = error.localizedDescription } }
        }
    }
}
