import Foundation
import Observation

@MainActor @Observable final class DeviceRecents {
    private(set) var items: [DeviceRecent] = []
    private(set) var message = ""
    private let storageDirectory: URL?
    init(storageDirectory: URL? = nil) { self.storageDirectory = storageDirectory }
    private var ownerID = ""
    private var blocked = false
    func load(ownerID: String) {
        guard self.ownerID != ownerID else { return }
        self.ownerID = ownerID; items = []; message = ""; blocked = false
        guard !ownerID.isEmpty else { return }
        do {
            let file = try storage()
            if FileManager.default.fileExists(atPath: file.path) { items = Array(try JSONDecoder().decode([DeviceRecent].self, from: Data(contentsOf: file)).prefix(80)) }
        } catch { blocked = true; message = "Recents could not be opened. The existing history has been kept." }
    }
    func opened(song: APIRecord, computerID: String) {
        guard !computerID.isEmpty, song.id.count == 64 else { return }
        save(DeviceRecent(kind: .song, computerID: computerID, itemID: song.id, title: song.title, firstSlide: song["firstSlide"].text, groupName: song["groupName"].text, filePath: "", openedAt: .now))
    }
    func opened(file: FilePreviewItem) {
        save(DeviceRecent(kind: .file, computerID: "", itemID: file.path, title: file.filename, firstSlide: "", groupName: "", filePath: file.path, openedAt: .now))
    }
    private func save(_ item: DeviceRecent) {
        guard !ownerID.isEmpty, !blocked else { return }
        let proposed = [item] + items.filter { $0.id != item.id }.prefix(79)
        persist(proposed)
    }
    func remove(id: String) { persist(items.filter { $0.id != id }) }
    func prune(before cutoff: Date?) {
        guard let cutoff else { return }
        persist(items.filter { $0.openedAt >= cutoff })
    }
    func reconcile(checkedIDs: Set<String>, availableIDs: Set<String>) {
        guard availableIDs.isSubset(of: checkedIDs) else { message = "Recents could not be checked. Existing history has been kept."; return }
        persist(items.filter { !checkedIDs.contains($0.id) || availableIDs.contains($0.id) })
    }
    private func persist(_ proposed: [DeviceRecent]) {
        guard !ownerID.isEmpty, !blocked, proposed != items else { return }
        do { try JSONEncoder().encode(proposed).write(to: storage(), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]); items = proposed; message = "" }
        catch { message = "Recents could not be updated on this device. Existing history has been kept." }
    }
    private func storage() throws -> URL {
        guard UUID(uuidString: ownerID) != nil else { throw CocoaError(.fileReadInvalidFileName) }
        var namespace = "DeviceRecents"
        #if DEBUG && targetEnvironment(simulator)
        if NativeReview.route != nil { namespace = "SimulatorReview/" + namespace }
        #endif
        let folder = storageDirectory ?? URL.applicationSupportDirectory.appending(path: namespace, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        return folder.appending(path: ownerID + ".json")
    }
}
