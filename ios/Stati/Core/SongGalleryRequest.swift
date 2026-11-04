import Foundation

nonisolated struct SongGalleryRequest: Identifiable, Sendable {
    let id = UUID()
    let computerID: String
    let items: [SongGalleryItem]
    let position: ReaderPosition
    let isService: Bool
    init?(computerID: String, items: [SongGalleryItem], selectedID: String, service: Bool = false) {
        guard !computerID.isEmpty, let position = ReaderPosition(ids: items.map(\.id), selectedID: selectedID) else { return nil }
        self.computerID = computerID; self.position = position; self.isService = service
        self.items = position.ids.compactMap { id in items.first { $0.id == id } }
    }
    init?(computerID: String, songs: [APIRecord], selectedID: String, service: Bool = false) {
        self.init(computerID: computerID, items: songs.map { SongGalleryItem(id: $0.id, songID: service ? $0["songId"].text : $0.id, title: $0.title) }.filter { !$0.songID.isEmpty }, selectedID: selectedID, service: service)
    }
}
