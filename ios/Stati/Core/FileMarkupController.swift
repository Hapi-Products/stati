import SwiftUI

@MainActor @Observable final class FileMarkupController {
    let store: AppStore
    private let ownerID: String
    private let epoch: UUID
    private(set) var intent: FileEditIntent?
    private(set) var source: URL?
    private(set) var busy = false
    private(set) var canEdit = false
    private(set) var currentSHA = ""
    private(set) var readable = false
    private var preparedBase: (item: FilePreviewItem, data: Data)?
    private var previewClosed = false
    private var syncLateSaves = false
    func prepare(item: FilePreviewItem, url: URL) -> Bool {
        guard active, !busy, !needsSync, canEdit, let data = try? Data(contentsOf: url), FileMarkupStorage.digest(data) == currentSHA else { return false }
        preparedBase = (item, data); source = url; previewClosed = false; syncLateSaves = true
        return true
    }
    private(set) var message = ""
    var needsSync: Bool { intent?.needsSync == true }
    init(store: AppStore) { self.store = store; ownerID = store.me?.id ?? ""; epoch = store.accountEpoch }
    private var active: Bool { !ownerID.isEmpty && store.me?.id == ownerID && store.accountEpoch == epoch && store.api.signedIn }
    func inspect(_ item: FilePreviewItem) async {
        guard active, let target = FileEditTarget(path: item.path) else { return }
        canEdit = false; readable = false; message = ""
        do {
            intent = try FileMarkupStorage.latest(ownerID: ownerID, path: item.path)
            let result = try await store.api.request(target.endpoint)
            guard active else { return }; readable = true; canEdit = result["canEdit"].flag; currentSHA = result["file"]["sha256"].text
            if needsSync { message = "Markup is saved on this device and waiting to sync." }
        } catch { if active { canEdit = false; message = error.localizedDescription } }
    }
    func open(item: FilePreviewItem, url: URL) async -> Bool {
        guard active, !busy, !needsSync, canEdit, let target = FileEditTarget(path: item.path) else { return false }
        busy = true; defer { busy = false }
        do {
            let data = try Data(contentsOf: url, options: .mappedIfSafe)
            let info = try await store.api.request(target.endpoint)
            guard active else { return false }
            guard info["canEdit"].flag, info["file"]["sha256"].text == FileMarkupStorage.digest(data) else { throw FileMarkupStorage.failure("This file changed. Close the viewer and reopen its current version before using Markup.") }
            let created = try FileMarkupStorage.begin(ownerID: ownerID, item: item, data: data)
            intent = created.0; source = created.1; message = ""
            return true
        } catch { if active { message = error.localizedDescription }; return false }
    }
    func saved(_ url: URL) {
        guard active else { return }
        do {
            if let base = preparedBase {
                self.intent = try FileMarkupStorage.begin(ownerID: ownerID, item: base.item, data: base.data).0
                preparedBase = nil
            }
            guard let intent else { return }
            self.intent = try (intent.state == .unconfirmed || intent.state == .synced) ? FileMarkupStorage.nextAfter(intent, editedURL: url) : FileMarkupStorage.stage(intent, editedURL: url); message = "Markup is saved on this device."
            if previewClosed && syncLateSaves { Task { await sync() } }
        }
        catch { message = error.localizedDescription }
    }
    func editorClosed() async { previewClosed = true; source = nil; if needsSync { await sync() } }
    func sync() async {
        guard active, !busy, var value = intent, value.needsSync else { return }
        busy = true; defer { busy = false }
        do {
            if let earliest = try FileMarkupStorage.latest(ownerID: ownerID, path: value.sourcePath, oldestPending: true) { value = earliest }
            let file = try FileMarkupStorage.verifiedFile(value)
            guard value.bytes <= (value.target.kind == "task" ? 8 : 12) * 1024 * 1024 else { throw FileMarkupStorage.failure("This edit is saved on this device but is too large to sync. Export it or use the current shared version.") }
            let info = try await store.api.request(value.target.endpoint + "?intent=" + value.id)
            guard active else { return }
            if value.accepts(info["edit"]) { try confirmed(value); return }
            guard info["canEdit"].flag else { throw FileMarkupStorage.failure("You no longer have permission to update this original. Your Markup is kept on this device.") }
            guard info["edit"]["state"].text != "failed", info["file"]["sha256"].text == value.baseSHA256 else { throw FileMarkupStorage.failure("This file changed on another device. Your Markup is kept here; export it before reopening the current version.") }
            value.state = .unconfirmed; try FileMarkupStorage.save(value); intent = value
            let response = try await store.api.bytes(value.target.endpoint, method: "PUT", body: Data(contentsOf: file), headers: ["Content-Type": "application/octet-stream", "Content-Length": String(value.bytes), "X-Edit-ID": value.id, "X-Base-SHA256": value.baseSHA256, "X-Content-SHA256": value.sha256, "X-Filename": value.filename.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "file"])
            guard active else { return }
            guard value.accepts(try JSONDecoder().decode(JSONValue.self, from: response)) else { throw FileMarkupStorage.failure("Saving was not confirmed. Your exact edit is kept on this device.") }
            try confirmed(value)
        } catch is CancellationError { }
        catch { if active { message = error.localizedDescription } }
    }
    func useCurrentVersion() {
        guard active, !busy, let current = intent else { return }
        do {
            while var pending = try FileMarkupStorage.latest(ownerID: ownerID, path: current.sourcePath, oldestPending: true) {
                pending.state = .keptOnDevice; try FileMarkupStorage.save(pending)
            }
            intent = try FileMarkupStorage.latest(ownerID: ownerID, path: current.sourcePath)
            message = "Using the current Stați version. Your earlier Markup is still kept on this device."
        } catch { message = error.localizedDescription }
    }
    private func confirmed(_ completed: FileEditIntent) throws {
        var saved = completed; saved.state = .synced; try FileMarkupStorage.save(saved)
        store.resources.invalidate(path: completed.sourcePath); store.filesChanged()
        let latest = try FileMarkupStorage.latest(ownerID: ownerID, path: completed.sourcePath)
        intent = latest?.needsSync == true ? latest : saved
        message = needsSync ? "Another saved edit is waiting to sync." : "Saved on this device and Stați."
    }
    var savedFile: URL? { intent.flatMap { try? FileMarkupStorage.verifiedFile($0) } }
}
