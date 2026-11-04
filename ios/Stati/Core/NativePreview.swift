import Foundation

@MainActor
enum NativePreview {
    static func download(api: APIClient, path: String, filename: String) async throws -> URL {
        try await stage(data: api.bytes(path), filename: filename)
    }
    static func stage(data: Data, filename: String) throws -> URL {
        let directory = URL.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let cleaned = filename.replacing("/", with: "_").replacing("\\", with: "_").trimmingCharacters(in: .whitespacesAndNewlines)
        let safe = cleaned == "." || cleaned == ".." ? "Shared file" : cleaned
        let url = directory.appending(path: safe.isEmpty ? "Shared file" : safe)
        do {
            try Task.checkCancellation()
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            return url
        } catch { try? FileManager.default.removeItem(at: directory); throw error }
    }
    static func remove(_ url: URL) {
        let directory = url.deletingLastPathComponent().standardizedFileURL
        guard directory.deletingLastPathComponent().path == URL.temporaryDirectory.standardizedFileURL.path,
              UUID(uuidString: directory.lastPathComponent) != nil else { return }
        try? FileManager.default.removeItem(at: directory)
    }
}
