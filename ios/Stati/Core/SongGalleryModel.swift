import SwiftUI

@MainActor @Observable final class SongGalleryModel {
    let request: SongGalleryRequest
    private(set) var position: ReaderPosition
    private(set) var song: APIRecord?
    private(set) var files: [APIRecord] = []
    private(set) var fileRequest: FilePreviewRequest?
    private(set) var loading = false
    private(set) var message = ""
    var choosingNotes = false
    @ObservationIgnored private let store: AppStore
    @ObservationIgnored private let fetch: @MainActor (String) async throws -> JSONValue
    @ObservationIgnored private let mutate: @MainActor (String, JSONValue) async throws -> JSONValue
    private let owner: String
    private let epoch: UUID
    private let computerAtOpen: String
    private var generation = UUID()
    var selected: SongGalleryItem { request.items[position.index] }
    private var active: Bool { !owner.isEmpty && store.me?.id == owner && store.accountEpoch == epoch && store.api.signedIn && store.selectedComputer == computerAtOpen }
    init(store: AppStore, request: SongGalleryRequest, mutate: (@MainActor (String, JSONValue) async throws -> JSONValue)? = nil, fetch: (@MainActor (String) async throws -> JSONValue)? = nil) {
        self.store = store; self.request = request; position = request.position
        owner = store.me?.id ?? ""; epoch = store.accountEpoch; computerAtOpen = store.selectedComputer
        self.mutate = mutate ?? { try await store.api.request($0, method: "POST", body: $1) }
        self.fetch = fetch ?? { try await store.api.request($0) }
    }
    func move(by step: Int) {
        guard active, position.move(by: step) else { return }
        generation = UUID(); song = nil; files = []; fileRequest = nil; choosingNotes = false; message = ""; loading = false
    }
    func selectSong(_ id: String) {
        guard active, let next = ReaderPosition(ids: request.items.map(\.id), selectedID: id), next.index != position.index else { return }
        position = next
        generation = UUID(); song = nil; files = []; fileRequest = nil; choosingNotes = false; message = ""; loading = false
    }
    func selectServiceSong(_ id: String) {
        guard request.isService else { return }
        selectSong(id)
    }
    func showLyrics() { guard active else { return }; fileRequest = nil; choosingNotes = false }
    func choose(_ file: APIRecord) {
        guard active, files.contains(where: { $0.id == file.id }), !file["removalPending"].flag else { return }
        fileRequest = FilePreviewRequest(record: file, pathKey: "fileUrl"); choosingNotes = false
    }
    func unlink(_ file: APIRecord) async throws {
        guard active, store.canPlan, files.contains(where: { $0.id == file.id && $0["canDelete"].flag }) else { throw APIError(status: 403, message: "You cannot unlink this file.") }
        let scope = generation
        let receipt = try await mutate("/group-materials/" + file.id + "/song-links", .object(["action": .string("unlink"), "computerId": .string(request.computerID), "songId": .string(selected.songID)]))
        try Task.checkCancellation(); guard active, scope == generation else { return }
        guard receipt["ok"].flag, !receipt["linked"].flag, receipt["materialId"].text == file.id, receipt["computerId"].text == request.computerID, receipt["songId"].text == selected.songID else { throw APIError(status: 409, message: "The unlink was not confirmed. Reopen Notes and try again.") }
        files.removeAll { $0.id == file.id }
    }
    func load() async {
        guard active else { song = nil; files = []; fileRequest = nil; loading = false; return }
        let scope = UUID(), item = selected; generation = scope
        song = nil; files = []; fileRequest = nil; choosingNotes = false; message = ""; loading = true
        defer { if generation == scope { loading = false } }
        do {
            if request.offline {
                guard let cached = try cachedSong(item) else {
                    message = "This version of the song is unavailable offline."
                    return
                }
                showOfflineSong(cached)
                return
            }
            let value = try await fetch("/computers/" + request.computerID + "/songs/" + item.songID)
            try Task.checkCancellation(); guard active, generation == scope else { return }
            guard value["id"].text == item.songID, !request.isService || item.contentHash.isEmpty || value["contentHash"].text == item.contentHash else { throw APIError(status: 409, message: "The selected song could not be verified. Try opening it again.") }
            let loaded = APIRecord(raw: value.fields); song = loaded; store.recents.opened(song: loaded, computerID: request.computerID)
            var cursor = "", seen: Set<String> = [], ids: Set<String> = []
            var authorizedFiles: [APIRecord] = []
            repeat {
                let response = try await fetch("/group-materials?computerId=" + request.computerID.queryEncoded + "&songId=" + item.songID.queryEncoded + (cursor.isEmpty ? "" : "&before=" + cursor.queryEncoded))
                try Task.checkCancellation(); guard active, generation == scope else { return }
                let page = try SongNotesPage(response, computerID: request.computerID, songID: item.songID)
                authorizedFiles += page.files.filter { ids.insert($0.id).inserted }
                cursor = page.nextCursor
                if !cursor.isEmpty && (!seen.insert(cursor).inserted || seen.count > 100) { throw APIError(status: 409, message: "The notes list could not be completed. Try again.") }
            } while !cursor.isEmpty
            files = authorizedFiles
            if loaded.raw["text"] != nil { try? await store.offlineSongs.save([loaded], computer: request.computerID) }
            // The selected reader mode opens first; linked notes stay in the navigation menu.
        } catch is CancellationError { }
        catch {
            guard active, generation == scope else { return }
            files = []; fileRequest = nil; choosingNotes = false
            if OfflineReadPolicy.permits(error), let saved = try? cachedSong(item) {
                showOfflineSong(saved)
                return
            }
            if song == nil, let failure = error as? APIError, [401,403,404].contains(failure.status) { store.offlineSongs.invalidate(computer: request.computerID) }
            message = song == nil ? error.localizedDescription : "Song notes could not be checked. " + error.localizedDescription
        }
    }
    private func cachedSong(_ item: SongGalleryItem) throws -> APIRecord? {
        try store.offlineSongs.rows(computer: request.computerID).first {
            $0.id == item.songID && (item.contentHash.isEmpty || item.contentHash == $0["contentHash"].text)
        }
    }

    private func showOfflineSong(_ saved: APIRecord) {
        song = saved
        message = "Offline · saved on this device."
        store.recents.opened(song: saved, computerID: request.computerID)
    }

}
