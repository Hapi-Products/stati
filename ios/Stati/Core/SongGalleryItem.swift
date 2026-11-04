import Foundation

nonisolated struct SongGalleryItem: Identifiable, Sendable {
    let id: String
    let songID: String
    let title: String
}
