import Foundation
import CryptoKit

@MainActor enum FileMarkupStorage {
    static func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    static func directory(ownerID: String) throws -> URL {
        guard UUID(uuidString: ownerID) != nil else { throw failure("Sign in again before using Markup.") }
        var namespace = "FileMarkup"
        #if DEBUG && targetEnvironment(simulator)
        if NativeReview.route != nil { namespace = "SimulatorReview/" + namespace }
        #endif
        let folder = URL.applicationSupportDirectory.appending(path: namespace, directoryHint: .isDirectory).appending(path: ownerID, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        return folder
    }
    static func folder(_ intent: FileEditIntent) throws -> URL {
        guard UUID(uuidString: intent.id) != nil, FileEditTarget(path: intent.sourcePath) == intent.target else { throw failure("This saved edit could not be verified. Its existing files have been kept.") }
        let folder = try directory(ownerID: intent.ownerID).appending(path: digest(Data(intent.sourcePath.utf8)), directoryHint: .isDirectory).appending(path: intent.id, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        return folder
    }
    static func save(_ intent: FileEditIntent) throws { try JSONEncoder().encode(intent).write(to: folder(intent).appending(path: "edit.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
    static func latest(ownerID: String, path: String, oldestPending: Bool = false) throws -> FileEditIntent? {
        let directory = try directory(ownerID: ownerID).appending(path: digest(Data(path.utf8)), directoryHint: .isDirectory)
        guard FileManager.default.fileExists(atPath: directory.path) else { return nil }
        let entries = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).filter { UUID(uuidString: $0.lastPathComponent) != nil }
        let intents = try entries.compactMap { folder -> FileEditIntent? in
            let metadata = folder.appending(path: "edit.json")
            guard FileManager.default.fileExists(atPath: metadata.path) else { return nil }
            let item = try JSONDecoder().decode(FileEditIntent.self, from: Data(contentsOf: metadata))
            guard item.ownerID == ownerID, item.id == folder.lastPathComponent else { throw failure("A saved edit could not be verified. Its existing files have been kept.") }
            return item.sourcePath == path ? item : nil
        }
        let pending = intents.filter(\.needsSync)
        if oldestPending { return pending.min(by: { $0.createdAt < $1.createdAt }) }
        return pending.max(by: { $0.createdAt < $1.createdAt }) ?? intents.max(by: { $0.createdAt < $1.createdAt })
    }
    static func verifiedFile(_ intent: FileEditIntent) throws -> URL {
        guard intent.contentFile == URL(filePath: intent.contentFile).lastPathComponent, !intent.contentFile.contains("/"), !intent.contentFile.contains("\\"), intent.contentFile.hasPrefix("content-") else { throw failure("The saved edit filename is invalid. Its files have been kept.") }
        let file = try folder(intent).appending(path: intent.contentFile)
        let data = try Data(contentsOf: file, options: .mappedIfSafe)
        guard data.count == intent.bytes, digest(data) == intent.sha256 else { throw failure("The saved edit could not be verified. Its existing bytes have been kept.") }
        return file
    }
    static func begin(ownerID: String, item: FilePreviewItem, data: Data) throws -> (FileEditIntent, URL) {
        guard let target = FileEditTarget(path: item.path) else { throw failure("Markup is unavailable for this file.") }
        if let saved = try latest(ownerID: ownerID, path: item.path), saved.needsSync { throw failure("Sync the saved Markup before editing this original again.") }
        let checksum = digest(data), ext = URL(filePath: item.filename).pathExtension.lowercased()
        guard ["pdf", "jpg", "jpeg", "png", "webp"].contains(ext) else { throw failure("Markup supports images and PDFs.") }
        let draft = FileEditIntent(id: UUID().uuidString.lowercased(), ownerID: ownerID, sourcePath: item.path, target: target, baseSHA256: checksum, sha256: checksum, bytes: data.count, filename: TransferFilename.safe(item.filename), contentFile: "content-" + checksum + "." + ext, state: .editing, createdAt: .now)
        let source = try folder(draft).appending(path: draft.contentFile)
        try data.write(to: source, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]); try save(draft)
        return (draft, source)
    }
    static func stage(_ intent: FileEditIntent, editedURL: URL) throws -> FileEditIntent {
        guard intent.state == .editing || intent.state == .ready else { throw failure("This saved edit is already being synchronized.") }
        let size = try editedURL.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard (1...(50 * 1024 * 1024)).contains(size) else { throw failure("The edited file is too large. Its prior saved version has been kept.") }
        let data = try Data(contentsOf: editedURL, options: .mappedIfSafe), checksum = digest(data)
        var ext = editedURL.pathExtension.lowercased()
        if !["pdf", "jpg", "jpeg", "png", "webp"].contains(ext) { ext = URL(filePath: intent.filename).pathExtension.lowercased() }
        var next = intent; next.sha256 = checksum; next.bytes = data.count; next.contentFile = "content-" + checksum + "." + ext; next.filename = TransferFilename.safe(URL(filePath: intent.filename).deletingPathExtension().lastPathComponent + "." + ext); next.state = .ready
        try data.write(to: folder(next).appending(path: next.contentFile), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]); try save(next)
        return next
    }
    static func nextAfter(_ previous: FileEditIntent, editedURL: URL) throws -> FileEditIntent {
        _ = try verifiedFile(previous)
        var next = FileEditIntent(id: UUID().uuidString.lowercased(), ownerID: previous.ownerID, sourcePath: previous.sourcePath, target: previous.target, baseSHA256: previous.sha256, sha256: previous.sha256, bytes: previous.bytes, filename: previous.filename, contentFile: previous.contentFile, state: .editing, createdAt: .now)
        let base = try Data(contentsOf: verifiedFile(previous))
        try base.write(to: folder(next).appending(path: next.contentFile), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        next = try stage(next, editedURL: editedURL)
        return next
    }
    static func failure(_ text: String) -> NSError { NSError(domain: "FileMarkup", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
}
