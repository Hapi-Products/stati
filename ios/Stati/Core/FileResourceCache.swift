import Foundation
import UIKit

/// Ephemeral, protected copies only. Originals and saved Markup are owned by their separate stores.
@MainActor final class FileResourceCache {
    private struct Entry { let url: URL; let bytes: Int; var accessed: Date }
    private var entries: [String: Entry] = [:]
    private var flights: [String: (id: UUID, task: Task<Data, Error>)] = [:]
    private var generation = UUID()
    private var thumbnailKeys: Set<String> = []
    private var waiters: [String: Set<UUID>] = [:]
    private var activeDownloads = 0
    private let thumbnails = NSCache<NSString, UIImage>()
    private static let processID = UUID().uuidString
    private let directory: URL?
    init() {
        thumbnails.countLimit = 120; thumbnails.totalCostLimit = 20 * 1024 * 1024
        let root = URL.cachesDirectory.appending(path: "StatiFilePreviews", directoryHint: .isDirectory)
        do {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            for old in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) where old.lastPathComponent != Self.processID && UUID(uuidString: old.lastPathComponent) != nil {
                try? FileManager.default.removeItem(at: old)
            }
            let folder = root.appending(path: Self.processID, directoryHint: .isDirectory).appending(path: UUID().uuidString, directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]); directory = folder
        } catch { directory = nil }
    }
    private func remove(_ url: URL) {
        guard let directory, url.deletingLastPathComponent().standardizedFileURL == directory.standardizedFileURL else { return }
        try? FileManager.default.removeItem(at: url)
    }
    func key(owner: String, item: FilePreviewItem) -> String { owner + "|" + item.path + "|" + item.contentVersion }
    func thumbnail(_ key: String) -> UIImage? { thumbnails.object(forKey: key as NSString) }
    func thumbnail(_ image: UIImage, key: String) {
        if thumbnailKeys.count >= 120, !thumbnailKeys.contains(key), let old = thumbnailKeys.first { thumbnailKeys.remove(old); thumbnails.removeObject(forKey: old as NSString) }
        thumbnailKeys.insert(key); thumbnails.setObject(image, forKey: key as NSString, cost: Int(image.size.width * image.size.height * image.scale * image.scale * 4))
    }
    func bytes(key: String, filename: String, download: @escaping @MainActor () async throws -> Data) async throws -> Data {
        if var entry = entries[key] {
            do { let data = try Data(contentsOf: entry.url, options: .mappedIfSafe); entry.accessed = Date(); entries[key] = entry; return data }
            catch { entries.removeValue(forKey: key) }
        }
        if let flight = flights[key] { return try await wait(for: flight.task, key: key) }
        let scope = generation, flightID = UUID()
        let task = Task<Data, Error> {
            while activeDownloads >= 4 { try await Task.sleep(for: .milliseconds(25)) }
            try Task.checkCancellation(); guard scope == generation else { throw CancellationError() }
            activeDownloads += 1; defer { activeDownloads -= 1 }
            let data = try await download()
            try Task.checkCancellation(); guard scope == generation else { throw CancellationError() }
            guard data.count <= 12 * 1024 * 1024 else { throw APIError(status: 413, message: "This preview is too large.") }
            if let directory {
                let url = directory.appending(path: UUID().uuidString)
                do { try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]); entries[key] = Entry(url: url, bytes: data.count, accessed: Date()); trim() }
                catch { remove(url) } // Viewing does not require a successful cache write.
            }
            return data
        }
        flights[key] = (flightID, task)
        defer { if scope == generation && flights[key]?.id == flightID { flights.removeValue(forKey: key) } }
        return try await wait(for: task, key: key)
    }
    private func wait(for task: Task<Data, Error>, key: String) async throws -> Data {
        let lease = UUID(); waiters[key, default: []].insert(lease)
        defer { release(lease, key: key, cancel: false) }
        return try await withTaskCancellationHandler { try await task.value } onCancel: {
            Task { @MainActor in self.release(lease, key: key, cancel: true) }
        }
    }
    private func release(_ lease: UUID, key: String, cancel: Bool) {
        guard waiters[key]?.remove(lease) != nil else { return }
        if waiters[key]?.isEmpty == true { waiters.removeValue(forKey: key); if cancel { flights[key]?.task.cancel() } }
    }
    func invalidate(path: String) {
        let keys = Set(entries.keys).union(thumbnailKeys).union(flights.keys).filter { $0.contains("|" + path + "|") }
        for key in keys {
            if let entry = entries.removeValue(forKey: key) { remove(entry.url) }
            thumbnails.removeObject(forKey: key as NSString); thumbnailKeys.remove(key)
            flights.removeValue(forKey: key)?.task.cancel()
        }
    }
    func clear() {
        generation = UUID(); for flight in flights.values { flight.task.cancel() }; flights = [:]; waiters = [:]
        for entry in entries.values { remove(entry.url) }; entries = [:]; thumbnails.removeAllObjects(); thumbnailKeys = []
    }
    private func trim() {
        var size = entries.values.reduce(0) { $0 + $1.bytes }
        for (key, entry) in entries.sorted(by: { $0.value.accessed < $1.value.accessed }) {
            if size <= 48 * 1024 * 1024 && entries.count <= 64 { break }
            entries.removeValue(forKey: key); remove(entry.url); size -= entry.bytes
        }
    }
}
