import Foundation

/// Persist identities, never the installation-specific absolute app-container path.
nonisolated enum UploadLedger {
    private struct Document: Codable { let version: Int; let jobs: [UploadJob] }
    static func decode(_ data: Data, ownerID: String, directory: URL) throws -> [UploadJob] {
        let decoder = JSONDecoder()
        let rows: [UploadJob]
        if data.first(where: { ![9, 10, 13, 32].contains($0) }) == 91 { rows = try decoder.decode([UploadJob].self, from: data) }
        else {
            let document = try decoder.decode(Document.self, from: data)
            guard document.version == 2 else { throw CocoaError(.fileReadCorruptFile) }
            rows = document.jobs
        }
        guard UUID(uuidString: ownerID) != nil, Set(rows.map(\.id)).count == rows.count else { throw CocoaError(.fileReadCorruptFile) }
        return try rows.map { row in
            let filename = row.id + ".upload", url = row.localFile
            let relative = url.scheme == nil && url.relativeString == filename
            let legacy = url.isFileURL && url.lastPathComponent == filename && url.deletingLastPathComponent().lastPathComponent == ownerID && url.deletingLastPathComponent().deletingLastPathComponent().lastPathComponent == "Uploads"
            guard row.userID == ownerID, UUID(uuidString: row.id) != nil, UUID(uuidString: row.deviceID) != nil,
                  (1...(50 * 1024 * 1024)).contains(row.bytes), row.sha256.count == 64,
                  row.sha256.allSatisfy({ $0.isASCII && ("0123456789abcdef".contains($0)) }), relative || legacy else { throw CocoaError(.fileReadCorruptFile) }
            var resolved = row
            resolved.localFile = directory.appending(path: filename)
            return resolved
        }
    }
    static func encode(_ jobs: [UploadJob]) throws -> Data {
        let relative = try jobs.map { job in
            guard UUID(uuidString: job.id) != nil, let file = URL(string: job.id + ".upload") else { throw CocoaError(.fileWriteInvalidFileName) }
            var row = job; row.localFile = file; return row
        }
        return try JSONEncoder().encode(Document(version: 2, jobs: relative))
    }
}
