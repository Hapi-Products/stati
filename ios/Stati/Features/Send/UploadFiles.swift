import Foundation
import CryptoKit
import ImageIO
import UniformTypeIdentifiers

nonisolated enum UploadFiles {
    static func directory(userID: String) throws -> URL {
        guard UUID(uuidString: userID) != nil else { throw APIError(status: 0, message: "Sign in again before choosing files.") }
        var namespace = "Uploads"
        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("--review-screen") { namespace = "SimulatorReview/" + namespace }
        #endif
        let directory = URL.applicationSupportDirectory.appending(path: namespace + "/" + userID, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        return directory
    }
    @concurrent static func prepare(url: URL, userID: String, deviceID: String) async throws -> UploadJob {
        let scoped = url.startAccessingSecurityScopedResource(); defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size > 0 && size <= 50 * 1024 * 1024 else { throw APIError(status: 413, message: "Choose a non-empty file up to 50 MB.") }
        let id = UUID().uuidString.lowercased(), destination = try directory(userID: userID).appending(path: id + ".upload")
        do {
            try FileManager.default.copyItem(at: url, to: destination)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: destination.path)
            let handle = try FileHandle(forReadingFrom: destination); defer { try? handle.close() }
            var hash = SHA256(), total = 0
            while let bytes = try handle.read(upToCount: 1024 * 1024), !bytes.isEmpty {
                try Task.checkCancellation(); total += bytes.count
                guard total <= 50 * 1024 * 1024 else { throw APIError(status: 413, message: "The file became larger than 50 MB.") }
                hash.update(data: bytes)
            }
            guard total == size else { throw APIError(status: 409, message: "The file changed while being selected. Choose it again.") }
            return UploadJob(id: id, userID: userID, deviceID: deviceID, filename: TransferFilename.safe(url.lastPathComponent), localFile: destination, bytes: total, sha256: hash.finalize().map { String(format: "%02x", $0) }.joined())
        } catch { try? FileManager.default.removeItem(at: destination); throw error }
    }
    @concurrent static func photo(data: Data) async throws -> URL {
        guard data.count <= 50 * 1024 * 1024, let source = CGImageSourceCreateWithData(data as CFData, nil) else { throw APIError(status: 415, message: "Choose a photo up to 50 MB.") }
        let url = URL.temporaryDirectory.appending(path: "Photo-" + UUID().uuidString + ".jpg")
        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { throw APIError(status: 0, message: "The photo could not be prepared.") }
        CGImageDestinationAddImageFromSource(destination, source, 0, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { try? FileManager.default.removeItem(at: url); throw APIError(status: 0, message: "The photo could not be prepared.") }
        return url
    }
}
