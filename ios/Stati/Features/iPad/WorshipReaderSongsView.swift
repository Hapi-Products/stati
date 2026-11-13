import SwiftUI

struct WorshipReaderSongsView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let computerID: String
    let source: SongSelectorSource
    var offlineRequest: SongGalleryRequest? = nil
    let selected: SongGalleryItem
    let select: (SongGalleryRequest) -> Void
    @State private var service: APIRecord?
    @State private var loading = false
    @State private var message = ""
    @State private var query = ""

    private var items: [SongGalleryItem] {
        if let offlineRequest { return offlineRequest.items }
        if let service {
            return service["songs"].records.compactMap { row in
                let songID = row["songId"].text
                guard !songID.isEmpty else { return nil }
                return SongGalleryItem(id: row.id, songID: songID, title: row.title, contentHash: row["contentHash"].text)
            }
        }
        return store.recents.items.filter { $0.kind == .song && $0.computerID == computerID }
            .map { SongGalleryItem(id: $0.itemID, songID: $0.itemID, title: $0.title) }
    }

    private var matching: [SongGalleryItem] {
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return search.isEmpty ? items : items.filter { $0.title.localizedStandardContains(search) }
    }

    var body: some View {
        NavigationStack {
            List {
                if loading { ProgressView("Finding current service…") }
                if !message.isEmpty { NoticeView(text: message) }
                if !loading {
                    Section(offlineRequest != nil ? "Running order" : service?.title ?? "Recents") {
                        ForEach(matching) { song in
                            Button {
                                if let request = SongGalleryRequest(computerID: computerID, items: items, selectedID: song.id, service: service != nil || offlineRequest != nil, offline: offlineRequest != nil) { select(request) }
                            } label: {
                                HStack {
                                    Text(song.title).foregroundStyle(.primary)
                                    Spacer()
                                    if isSelected(song) { Image(systemName: "checkmark").foregroundStyle(.tint).accessibilityHidden(true) }
                                }
                                .frame(minHeight: 44)
                                .contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(isSelected(song) ? .isSelected : [])
                        }
                        if matching.isEmpty {
                            if query.isEmpty { Text(service == nil ? "No recent songs on this computer." : "This service has no songs.").foregroundStyle(.secondary) }
                            else { ContentUnavailableView.search(text: query) }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .searchable(text: $query, prompt: "Find a song")
            .navigationTitle("Song Selector")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close", systemImage: "xmark") { dismiss() }.labelStyle(.iconOnly) }
            }
        }
        .task { await loadService() }
    }

    private func isSelected(_ song: SongGalleryItem) -> Bool {
        service == nil && offlineRequest == nil ? song.songID == selected.songID : song.id == selected.id
    }

    private func loadService() async {
        guard offlineRequest == nil, source == .currentService else { return }
        let epoch = store.accountEpoch
        loading = true
        defer { loading = false }
        do {
            let response = try await store.api.request("/computers/" + computerID + "/services")
            try Task.checkCancellation()
            guard store.accountEpoch == epoch else { return }
            let activeID = response["activeServiceId"].text
            service = response["plans"].records.first { !$0["archived"].flag && ($0.id == activeID || $0["active"].flag) }
            if service == nil { message = "No current service. Showing recent songs." }
        } catch is CancellationError { }
        catch { if store.accountEpoch == epoch { message = "Couldn’t load the current service. Showing recent songs." } }
    }
}
