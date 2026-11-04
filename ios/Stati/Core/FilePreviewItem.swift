import Foundation

nonisolated struct FilePreviewItem: Identifiable, Equatable, Sendable {
    let path: String
    let filename: String
    let contentVersion: String
    var id: String { path }
    init?(record: APIRecord, pathKey: String) {
        let path = record[pathKey].text
        guard path.hasPrefix("/api/"), !path.contains("\\"), !path.contains("?"), !path.contains("#"),
              !path.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }),
              !path.contains("%"), path.hasSuffix("/file") || path.contains("/images/") else { return nil }
        self.path = path
        contentVersion = record["contentVersion"].text
        let name = record["filename"].text.trimmingCharacters(in: .whitespacesAndNewlines)
        filename = name.isEmpty ? "Shared file" : name
    }
}
