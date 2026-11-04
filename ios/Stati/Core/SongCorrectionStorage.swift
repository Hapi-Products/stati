import Foundation
import CryptoKit

nonisolated struct SongCorrectionStorage: Sendable {
    let ownerID: String
    let computerID: String
    let songID: String
    private let directory: URL
    init(ownerID: String, computerID: String, songID: String, root: URL? = nil) throws {
        guard UUID(uuidString: ownerID) != nil, UUID(uuidString: computerID) != nil, songID.count == 64, songID.allSatisfy(\.isHexDigit) else { throw CocoaError(.fileReadInvalidFileName) }
        self.ownerID = ownerID; self.computerID = computerID; self.songID = songID
        var base = root ?? URL.applicationSupportDirectory.appending(path: "SongComments")
        #if DEBUG && targetEnvironment(simulator)
        if root == nil && ProcessInfo.processInfo.arguments.contains("--review-screen") { base = URL.applicationSupportDirectory.appending(path: "SimulatorReview/SongComments") }
        #endif
        directory = base.appending(path: ownerID + "/" + computerID + "/" + songID, directoryHint: .isDirectory)
    }
    private var file: URL { directory.appending(path: "draft.json") }
    func load() throws -> SongCorrectionDraft? {
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        let value = try JSONDecoder().decode(SongCorrectionDraft.self, from: Data(contentsOf: file))
        try validate(value); return value
    }
    private func validate(_ value: SongCorrectionDraft) throws {
        guard UUID(uuidString: value.id) != nil, value.ownerID == ownerID, value.computerID == computerID, value.song.id == songID,
              value.song["contentHash"].text.count == 64, value.images.count <= 6, Set(value.images.map(\.id)).count == value.images.count,
              value.confirmedImages.isSubset(of: Set(value.images.map(\.id))), value.edits.count <= 10, Set(value.edits.map(\.id)).count == value.edits.count, value.edits.allSatisfy({ $0.valid(in: value.song["text"].text, requireReplacementLimit: false) }) else { throw CocoaError(.fileReadCorruptFile) }
        if value.phase != .editing { guard value.frozen != nil, value.payload["id"].text == value.id, value.payload["songId"].text == songID, value.payload["contentHash"] == value.song["contentHash"] else { throw CocoaError(.fileReadCorruptFile) } }
        for image in value.images { guard UUID(uuidString: image.id) != nil, image.bytes > 0, image.bytes <= 8 * 1024 * 1024, image.sha256.count == 64 else { throw CocoaError(.fileReadCorruptFile) } }
    }
    func save(_ value: SongCorrectionDraft) throws {
        try validate(value)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        try JSONEncoder().encode(value).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func archive(_ value: SongCorrectionDraft) throws {
        try save(value)
        let destination = directory.appending(path: value.id + ".json")
        if !FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.copyItem(at: file, to: destination) }
    }
    func imageFile(_ image: SongCorrectionImage) throws -> URL {
        guard UUID(uuidString: image.id) != nil else { throw CocoaError(.fileReadInvalidFileName) }
        return directory.appending(path: image.id + ".jpg")
    }
    func stage(_ data: Data) throws -> SongCorrectionImage {
        guard !data.isEmpty, data.count <= 8 * 1024 * 1024 else { throw CocoaError(.fileWriteFileExists) }
        let image = SongCorrectionImage(id: UUID().uuidString.lowercased(), filename: "photo.jpg", bytes: data.count, sha256: Self.digest(data))
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        try data.write(to: imageFile(image), options: [.withoutOverwriting, .completeFileProtectionUntilFirstUserAuthentication]); return image
    }
    func bytes(_ image: SongCorrectionImage) throws -> Data {
        let data = try Data(contentsOf: imageFile(image))
        guard data.count == image.bytes, Self.digest(data) == image.sha256 else { throw CocoaError(.fileReadCorruptFile) }; return data
    }
    private static func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
}
