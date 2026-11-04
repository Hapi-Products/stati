import Foundation
import CryptoKit

@MainActor enum GroupScanStorage {
    static func directory(ownerID: String) throws -> URL {
        guard UUID(uuidString: ownerID) != nil else { throw failure("Sign in again before scanning a document.") }
        var namespace = "GroupScans"
        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("--review-screen") { namespace = "SimulatorReview/" + namespace }
        #endif
        let directory = URL.applicationSupportDirectory.appending(path: namespace, directoryHint: .isDirectory).appending(path: ownerID, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        return directory
    }
    static func create(data: Data, ownerID: String, group: String, groupID: String? = nil) throws -> GroupScanDraft {
        guard (1...(12 * 1024 * 1024)).contains(data.count), data.starts(with: Data("%PDF".utf8)) else { throw failure("Scan a PDF up to 12 MB. Try fewer pages if this scan is too large.") }
        let draft = GroupScanDraft(id: UUID().uuidString.lowercased(), ownerID: ownerID, bytes: data.count, sha256: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(), title: "Scanned document", groupName: group, groupID: groupID, sharingUnconfirmed: false)
        let directory = try directory(ownerID: ownerID)
        let file = directory.appending(path: draft.filename)
        try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        do { try save(draft) } catch { try? FileManager.default.removeItem(at: file); throw error }
        return draft
    }
    static func save(_ draft: GroupScanDraft) throws {
        guard UUID(uuidString: draft.id) != nil else { throw failure("This scan draft could not be saved. Its existing files have been kept.") }
        let file = try directory(ownerID: draft.ownerID).appending(path: draft.id + ".json")
        try JSONEncoder().encode(draft).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    static func load(ownerID: String) throws -> [GroupScanDraft] {
        let directory = try directory(ownerID: ownerID)
        return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).filter { $0.pathExtension == "json" }.sorted { $0.lastPathComponent < $1.lastPathComponent }.map { file in
            let draft = try JSONDecoder().decode(GroupScanDraft.self, from: Data(contentsOf: file))
            guard draft.ownerID == ownerID, UUID(uuidString: draft.id) != nil, file.lastPathComponent == draft.id + ".json" else { throw failure("This scan draft could not be verified. Its existing files have been kept.") }
            _ = try verifiedFile(draft)
            return draft
        }
    }
    static func verifiedFile(_ draft: GroupScanDraft) throws -> URL {
        guard UUID(uuidString: draft.id) != nil else { throw failure("This scan draft could not be opened.") }
        let file = try directory(ownerID: draft.ownerID).appending(path: draft.filename)
        let data = try Data(contentsOf: file, options: .mappedIfSafe)
        guard data.count == draft.bytes, SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == draft.sha256 else { throw failure("This scan draft could not be verified. The existing file has been kept.") }
        return file
    }
    static func remove(_ draft: GroupScanDraft) throws {
        guard UUID(uuidString: draft.id) != nil else { throw failure("This scan draft could not be removed.") }
        let directory = try directory(ownerID: draft.ownerID)
        let pdf = directory.appending(path: draft.filename), metadata = directory.appending(path: draft.id + ".json")
        if FileManager.default.fileExists(atPath: pdf.path) { _ = try verifiedFile(draft); try FileManager.default.removeItem(at: pdf) }
        if FileManager.default.fileExists(atPath: metadata.path) { try FileManager.default.removeItem(at: metadata) }
    }
    static func failure(_ message: String) -> NSError { NSError(domain: "StatiScan", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
}
