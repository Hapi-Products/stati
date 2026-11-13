import SwiftUI

@MainActor @Observable final class OfflineSongs {
    private weak var store: AppStore?
    private var failure = ""
    private var failureComputer = ""
    @ObservationIgnored private var worker: Task<Void, Never>?
    @ObservationIgnored private var token = UUID()
    @ObservationIgnored private var scope = ""
    @ObservationIgnored private var pending: [String: APIRecord] = [:]
    @ObservationIgnored private var order: [String] = []
    @ObservationIgnored private var next = 0
    private var namespace: URL? {
        #if DEBUG && targetEnvironment(simulator)
        if NativeReview.route != nil { return URL.applicationSupportDirectory.appending(path: "SimulatorReview/OfflineSongs") }
        #endif
        return nil
    }
    private var documents: URL {
        #if DEBUG && targetEnvironment(simulator)
        if NativeReview.route != nil { return URL.documentsDirectory.appending(path: "SimulatorReview") }
        #endif
        return .documentsDirectory
    }
    private let allowsPDFWork: @MainActor () -> Bool
    init(store: AppStore, allowsPDFWork: @escaping @MainActor () -> Bool = {
        UIApplication.shared.applicationState == .active && !ProcessInfo.processInfo.isLowPowerModeEnabled && ProcessInfo.processInfo.thermalState == .nominal
    }) { self.store = store; self.allowsPDFWork = allowsPDFWork }
    private func storage(_ computer: String) throws -> OfflineSongStorage {
        guard let store, let owner = store.me?.id, store.api.signedIn else { throw CancellationError() }
        return try OfflineSongStorage(ownerID: owner, computerID: computer, root: namespace)
    }
    func rows(computer: String) throws -> [APIRecord] { try storage(computer).rows() }
    func services(computer: String) throws -> [APIRecord] { try storage(computer).services() }
    func saveService(_ plan: APIRecord, computer: String) throws { try storage(computer).saveService(plan) }
    func issue(computer: String) -> String { computer == failureComputer ? failure : "" }
    func cancel() { token = UUID(); worker?.cancel(); worker = nil; scope = ""; pending = [:]; order = []; next = 0; failure = ""; failureComputer = "" }
    func invalidate(computer: String) { cancel(); try? storage(computer).invalidate() }
    /// Source persistence completes before returning; PDF rendering never gates a library page.
    func save(_ songs: [APIRecord], computer: String, complete: Bool = false, renderPDFs: Bool = true) async throws {
        guard let store, let owner = store.me?.id, store.selectedComputer == computer, !Task.isCancelled else { throw CancellationError() }
        let cache = try storage(computer)
        try cache.save(songs, complete: complete)
        guard renderPDFs else { return }
        let current = owner + store.accountEpoch.uuidString + computer
        if complete || scope != current { cancel(); scope = current }
        for song in songs {
            if pending[song.id] == nil { order.append(song.id) }
            pending[song.id] = song
        }
        guard worker == nil, !pending.isEmpty else { return }
        failure = ""; failureComputer = computer
        let stamp = token, epoch = store.accountEpoch
        let accountName = store.me?.personName ?? "Account", computerName = store.computers.first(where: { $0.id == computer })?.name ?? "Computer"
        let columns = ReaderPreferences(ownerID: owner).settings.pdfColumns
        worker = Task(priority: .utility) { [weak self] in
            await self?.render(cache: cache, owner: owner, epoch: epoch, computer: computer, stamp: stamp, columns: columns, accountName: accountName, computerName: computerName)
        }
    }
    private func active(owner: String, epoch: UUID, computer: String, stamp: UUID) -> Bool {
        guard let store else { return false }
        return token == stamp && !Task.isCancelled && store.me?.id == owner && store.accountEpoch == epoch && store.selectedComputer == computer && store.api.signedIn && store.canReadSongs && !IPadRoleAccess.isBlocked(ministryRole: store.me?["ministryRole"].text ?? "", isPad: UIDevice.current.userInterfaceIdiom == .pad)
    }
    private func render(cache: OfflineSongStorage, owner: String, epoch: UUID, computer: String, stamp: UUID, columns: PDFColumnCount, accountName: String, computerName: String) async {
        defer { if token == stamp { worker = nil; pending = [:]; order = []; next = 0 } }
        do {
            await Task.yield()
            guard active(owner: owner, epoch: epoch, computer: computer, stamp: stamp) else { return }
            var available = try cache.existingPDFVersions(documents: documents)
            var batch: [(APIRecord, String, Data)] = []
            func flush() throws {
                let valid = batch.filter { item in pending[item.0.id].map { OfflineSongStorage.version($0, columns: columns) == item.1 } ?? true }
                if !valid.isEmpty {
                    _ = try cache.savePDFs(valid, documents: documents, accountName: accountName, computerName: computerName)
                    for item in valid { available[item.0.id] = item.1 }
                }
                batch = []
            }
            while next < order.count {
                guard active(owner: owner, epoch: epoch, computer: computer, stamp: stamp) else { return }
                while !allowsPDFWork() {
                    try await Task.sleep(for: .seconds(2))
                    guard active(owner: owner, epoch: epoch, computer: computer, stamp: stamp) else { return }
                }
                let id = order[next]; next += 1
                guard let song = pending.removeValue(forKey: id) else { continue }
                let version = OfflineSongStorage.version(song, columns: columns)
                if available[id] != version && !song["text"].text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    let bytes = try SongDocumentRenderer.document(text: song["text"].text, columns: columns)
                    let capacity = try? documents.deletingLastPathComponent().resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage
                    if let capacity, capacity < Int64(bytes.count) + 512 * 1024 * 1024 { throw APIError(status: 507, message: "Free up device space, then refresh Songs to retry.") }
                    batch.append((song, version, bytes))
                    if batch.count >= 4 { try flush() }
                    try await Task.sleep(for: .milliseconds(250))
                } else { await Task.yield() }
            }
            guard active(owner: owner, epoch: epoch, computer: computer, stamp: stamp) else { return }
            try flush()
        } catch is CancellationError { }
        catch {
            if active(owner: owner, epoch: epoch, computer: computer, stamp: stamp) {
                failureComputer = computer; failure = "Saved lyrics are available. PDF copies could not finish saving. " + error.localizedDescription
            }
        }
    }
}
