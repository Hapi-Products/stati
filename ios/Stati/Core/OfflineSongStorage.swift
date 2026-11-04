import Foundation
import CryptoKit

/// Protected app metadata is account/computer scoped. PDFs are ordinary user-owned Documents.
nonisolated struct OfflineSongStorage: Sendable {
    let ownerID: String
    let computerID: String
    private let directory: URL
    private struct Snapshot: Codable { let ownerID: String; let computerID: String; let songs: [APIRecord] }
    private struct PDFReceipt: Codable { let version: String; let relativePath: String }
    init(ownerID: String, computerID: String, root: URL? = nil) throws {
        guard UUID(uuidString: ownerID) != nil, UUID(uuidString: computerID) != nil else { throw CocoaError(.fileReadInvalidFileName) }
        self.ownerID = ownerID; self.computerID = computerID
        directory = (root ?? URL.applicationSupportDirectory.appending(path: "OfflineSongs")).appending(path: ownerID + "/" + computerID, directoryHint: .isDirectory)
    }
    func rows() throws -> [APIRecord] {
        let url = directory.appending(path: "catalog.json")
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        let value = try JSONDecoder().decode(Snapshot.self, from: Data(contentsOf: url))
        guard value.ownerID == ownerID, value.computerID == computerID else { throw CocoaError(.fileReadCorruptFile) }
        return value.songs
    }
    func save(_ songs: [APIRecord], complete: Bool) throws {
        guard songs.allSatisfy({ $0.id.count == 64 && $0.id.allSatisfy(\.isHexDigit) && $0.raw["text"] != nil }) else { throw CocoaError(.fileReadCorruptFile) }
        var values = complete ? [:] : Dictionary(try rows().map { ($0.id, $0) }, uniquingKeysWith: { _, latest in latest })
        for song in songs { values[song.id] = song }
        let snapshot = Snapshot(ownerID: ownerID, computerID: computerID, songs: values.values.sorted { $0.id < $1.id })
        try write(JSONEncoder().encode(snapshot), to: directory.appending(path: "catalog.json"))
    }
    func invalidate() throws { try save([], complete: true) }
    private func receipts() throws -> [String: PDFReceipt] {
        let url = directory.appending(path: "pdfs.json")
        guard FileManager.default.fileExists(atPath: url.path) else { return [:] }
        return try JSONDecoder().decode([String: PDFReceipt].self, from: Data(contentsOf: url))
    }
    func savedPDF(songID: String, version: String, documents: URL = .documentsDirectory) throws -> URL? {
        guard let receipt = try receipts()[songID], receipt.version == version,
              !receipt.relativePath.hasPrefix("/"), !receipt.relativePath.split(separator: "/").contains("..") else { return nil }
        let url = documents.appending(path: receipt.relativePath)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }
    func existingPDFVersions(documents: URL = .documentsDirectory) throws -> [String: String] {
        try receipts().reduce(into: [:]) { result, pair in
            let value = pair.value
            guard !value.relativePath.hasPrefix("/"), !value.relativePath.split(separator: "/").contains(".."), FileManager.default.fileExists(atPath: documents.appending(path: value.relativePath).path) else { return }
            result[pair.key] = value.version
        }
    }
    func savePDF(_ bytes: Data, song: APIRecord, version: String, documents: URL = .documentsDirectory, accountName: String, computerName: String) throws -> URL {
        try savePDFs([(song, version, bytes)], documents: documents, accountName: accountName, computerName: computerName)[0]
    }
    func savePDFs(_ exports: [(APIRecord, String, Data)], documents: URL = .documentsDirectory, accountName: String, computerName: String) throws -> [URL] {
        var values = try receipts(), urls: [URL] = []
        let components = ["Songs", Self.component(accountName, fallback: "Account"), Self.component(computerName, fallback: "Computer")]
        let folder = components.reduce(documents) { $0.appending(path: $1, directoryHint: .isDirectory) }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        for (song, version, bytes) in exports {
            if let old = values[song.id], old.version == version, !old.relativePath.hasPrefix("/"), !old.relativePath.split(separator: "/").contains("..") {
                let url = documents.appending(path: old.relativePath)
                if FileManager.default.fileExists(atPath: url.path) { urls.append(url); continue }
            }
            guard bytes.starts(with: Data("%PDF-".utf8)) else { throw CocoaError(.fileReadCorruptFile) }
            let title = Self.component(song.title, fallback: "Song")
            var suffix = 1, name = title + ".pdf"
            while FileManager.default.fileExists(atPath: folder.appending(path: name).path) { suffix += 1; name = title + " (" + String(suffix) + ").pdf" }
            let url = folder.appending(path: name)
            try bytes.write(to: url, options: [.withoutOverwriting, .completeFileProtectionUntilFirstUserAuthentication])
            values[song.id] = PDFReceipt(version: version, relativePath: (components + [name]).joined(separator: "/")); urls.append(url)
        }
        try write(JSONEncoder().encode(values), to: directory.appending(path: "pdfs.json"))
        return urls
    }
    static func version(_ song: APIRecord, columns: PDFColumnCount) -> String {
        SHA256.hash(data: Data((song.title + "\u{0}" + song["text"].text + "\u{0}" + String(columns.rawValue)).utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private static func component(_ text: String, fallback: String) -> String {
        let cleaned = text.components(separatedBy: CharacterSet(charactersIn: "/\\:\u{0}").union(.controlCharacters)).joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: ".")))
        return cleaned.isEmpty ? fallback : String(cleaned.prefix(100))
    }
    private func write(_ bytes: Data, to url: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        try bytes.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
