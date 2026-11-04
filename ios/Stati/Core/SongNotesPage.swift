import Foundation

/// Never treat an older server's unfiltered shared-file list as a song's notes.
nonisolated struct SongNotesPage: Sendable {
    let files: [APIRecord]
    let nextCursor: String
    init(_ response: JSONValue, computerID: String, songID: String) throws {
        guard response["linkContext"]["computerId"].text == computerID,
              response["linkContext"]["songId"].text == songID,
              !computerID.isEmpty, !songID.isEmpty else { throw SongNotesPageError.unconfirmedSong }
        guard case .array(let items) = response["materials"],
              response["nextCursor"] == .null || { if case .string = response["nextCursor"] { true } else { false } }() else { throw SongNotesPageError.invalidFiles }
        let files = items.map { APIRecord(raw: $0.fields) }
        guard files.allSatisfy({ UUID(uuidString: $0.id) != nil && $0["fileUrl"].text == "/api/group-materials/" + $0.id + "/file" }),
              Set(files.map(\.id)).count == files.count else { throw SongNotesPageError.invalidFiles }
        self.files = files
        nextCursor = response["nextCursor"].text
    }
    var automaticFile: APIRecord? {
        nextCursor.isEmpty && files.count == 1 && !files[0]["removalPending"].flag ? files[0] : nil
    }
}
