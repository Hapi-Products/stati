import Foundation

nonisolated enum SongNotesPageError: LocalizedError {
    case unconfirmedSong, invalidFiles
    var errorDescription: String? {
        switch self {
        case .unconfirmedSong: "Song notes could not be confirmed for this song. Try again after Stați’s server update."
        case .invalidFiles: "The shared notes list could not be opened. Refresh and try again."
        }
    }
}
