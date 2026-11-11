import SwiftUI

@MainActor @Observable
final class AppStore {
    let api: APIClient
    let uploads: UploadQueue
    let songCommands: SongCommands
    let recents = DeviceRecents()
    let resources = FileResourceCache()
    init() { let client = APIClient(); api = client; uploads = UploadQueue(api: client); songCommands = SongCommands(api: client); restoreOfflineAccount() }
    @ObservationIgnored lazy var offlineSongs = OfflineSongs(store: self)
    private func restoreOfflineAccount() {
        guard api.signedIn, let saved = OfflineIdentityStorage.read(fingerprint: api.sessionFingerprint) else { return }
        loadDrafts(saved.profile.id); me = saved.profile; computers = saved.computers
        selectedComputer = ComputerPreference.resolve(preferred: defaultComputer, current: selectedComputer, available: computers.map(\.id))
        uploads.load(userID: saved.profile.id); songCommands.load(ownerID: saved.profile.id)
    }
    private(set) var accountEpoch = UUID() { didSet { offlineSongs.cancel(); resources.clear(); lastTaskChange = nil; taskBadgeRefresh?.cancel(); accountRefresh?.cancel(); workspaceLive = false } }
    var me: APIRecord?
    var computers: [APIRecord] = []
    var selectedComputer = "" { didSet { if oldValue != selectedComputer { offlineSongs.cancel() } } }
    var defaultComputer = "" {
        didSet {
            guard !draftOwner.isEmpty, !loadingDrafts else { return }
            ComputerPreference.save(defaultComputer, ownerID: draftOwner)
            if computers.contains(where: { $0.id == defaultComputer }) { selectedComputer = defaultComputer }
        }
    }
    var loading = true
    var authenticating = false
    var taskCount = 0
    var workspaceLive = false
    var refreshDelay: Duration {
        let constrained = ProcessInfo.processInfo.isLowPowerModeEnabled || ProcessInfo.processInfo.thermalState != .nominal
        return .seconds((workspaceLive ? 120 : 30) * (constrained ? 2 : 1))
    }
    private var accountRefresh: Task<Void, Never>?
    private var taskBadgeRefresh: Task<Void, Never>?
    func tasksInvalidated() {
        guard me != nil, api.signedIn else { return }
        lastTaskChange = nil; taskChangeRevision += 1; taskBadgeRefresh?.cancel()
        if isCommenter { taskCount = 0; return }
        taskBadgeRefresh = Task { do { try await Task.sleep(for: .milliseconds(150)); await refreshTaskCount() } catch { } }
    }
    func refreshTaskCount() async {
        let owner = me?.id, epoch = accountEpoch, revision = taskChangeRevision
        guard owner != nil, api.signedIn, !isCommenter else { return }
        do {
            let value = try await api.request("/tasks?offset=0")
            try Task.checkCancellation()
            guard me?.id == owner, accountEpoch == epoch, revision == taskChangeRevision, let total = Int(exactly: value["total"].number), total >= 0 else { return }
            taskCount = total
        } catch let error as APIError where error.status == 401 || error.status == 403 { if accountEpoch == epoch { await refresh() } }
        catch { }
    }
    private(set) var taskChangeRevision = 0
    private(set) var lastTaskChange: APIRecord?
    private(set) var catalogChangeRevision = 0
    private(set) var groupChangeRevision = 0
    func workspaceInvalidated(_ type: String) {
        guard me != nil, api.signedIn else { return }
        if ["tasks-ready", "account-changed"].contains(type) {
            accountRefresh?.cancel(); let epoch = accountEpoch
            accountRefresh = Task { do { try await Task.sleep(for: .milliseconds(150)); guard epoch == accountEpoch else { return }; await refresh() } catch { } }
        }
        if UIDevice.current.userInterfaceIdiom != .pad, ["tasks-ready", "tasks-changed"].contains(type) { tasksInvalidated() }
        if ["tasks-ready", "catalog-changed"].contains(type) { catalogChangeRevision += 1 }
        if ["tasks-ready", "services-changed"].contains(type) { servicesChanged(computerID: selectedComputer) }
        if ["tasks-ready", "groups-changed"].contains(type) { groupChangeRevision += 1 }
        if ["tasks-ready", "groups-changed", "files-changed"].contains(type) { filesChanged() }
    }
    private(set) var serviceChangeRevision = 0
    private(set) var fileChangeRevision = 0
    func filesChanged() { fileChangeRevision += 1 }
    func taskChanged(_ task: APIRecord) {
        guard me != nil, api.signedIn, !task.id.isEmpty else { return }
        lastTaskChange = task; taskChangeRevision += 1
    }
    private(set) var lastCreatedService: (computerID: String, serviceID: String)?
    func servicesChanged(computerID: String, createdID: String? = nil) {
        guard me != nil, api.signedIn else { return }
        lastCreatedService = createdID.map { (computerID, $0) }; serviceChangeRevision += 1
    }

    var message = ""
    var taskDrafts: [String: [String: JSONValue]] = [:] { didSet { persistDrafts() } }
    var serviceDrafts: [String: [String: JSONValue]] = [:] { didSet { persistDrafts() } }
    var sendDraft = SendDraft() { didSet { persistDrafts() } }
    var draftWarning = ""
    private var draftOwner = ""
    private var loadingDrafts = false
    private var preserveUnreadableDraft = false
    private func persistDrafts() {
        guard !loadingDrafts, !draftOwner.isEmpty else { return }
        do {
            if preserveUnreadableDraft { try DraftStorage.preserveUnreadable(userID: draftOwner); preserveUnreadableDraft = false }
            try DraftStorage.save(DraftSnapshot(tasks: taskDrafts, services: serviceDrafts, send: sendDraft), userID: draftOwner)
            draftWarning = ""
        } catch { draftWarning = "Your draft could not be saved on this device. Keep Stați open and try editing again. " + error.localizedDescription }
    }
    private func loadDrafts(_ userID: String) {
        let changingOwner = draftOwner != userID
        loadingDrafts = true; defer { loadingDrafts = false }; if changingOwner { selectedComputer = ""; lastCreatedService = nil }; draftOwner = userID; taskDrafts = [:]; serviceDrafts = [:]; sendDraft = SendDraft(); draftWarning = ""; preserveUnreadableDraft = false
        recents.load(ownerID: userID)
        defaultComputer = ComputerPreference.read(ownerID: userID)
        guard !userID.isEmpty else { return }
        do { let saved = try DraftStorage.load(userID: userID); taskDrafts = saved.tasks; serviceDrafts = saved.services; sendDraft = saved.send } catch { preserveUnreadableDraft = true; draftWarning = "Your saved drafts could not be opened. The existing files have been kept." }
    }
    var isCommenter: Bool { me?["role"].text != "admin" && me?["ministryRole"].text == "commenter" }
    var canCommentSongs: Bool { isAdmin || me?["capabilities"]["commentSongs"].flag == true }
    var canReadSongs: Bool { me?["capabilities"]["readSongs"].flag == true }
    var canPlan: Bool { me?["capabilities"]["planServices"].flag == true }
    var isAdmin: Bool { me?["role"].text == "admin" }
    func refresh() async {
        let scope = accountEpoch
        loading = true
        defer { if scope == accountEpoch { loading = false } }
        guard api.signedIn else { me = nil; loading = false; return }
        do {
            let result = try await api.request("/me")
            let profile = APIRecord(raw: result["user"].fields)
            let devices = try await api.request("/devices").records
            try Task.checkCancellation()
            guard scope == accountEpoch else { return }
            if draftOwner != profile.id { accountEpoch = UUID(); loadDrafts(profile.id) }
            uploads.load(userID: profile.id)
            songCommands.load(ownerID: profile.id)
            computers = devices
            selectedComputer = ComputerPreference.resolve(preferred: defaultComputer, current: selectedComputer, available: computers.map(\.id))
            me = profile; message = ""; loading = false
            try? OfflineIdentityStorage.save(OfflineIdentity(sessionFingerprint: api.sessionFingerprint, profile: profile, computers: devices))
        } catch is CancellationError { }
        catch let error as APIError where error.status == 401 || error.status == 403 {
            guard scope == accountEpoch else { return }
            OfflineIdentityStorage.clear(); accountEpoch = UUID(); api.clearSession(); uploads.reset(); songCommands.reset(); me = nil; computers = []; loadDrafts(""); loading = false
        } catch { if scope == accountEpoch { message = OfflineReadPolicy.permits(error) && me != nil ? "Offline · saved songs are available." : error.localizedDescription } }
    }
    func signOut() async {
        let scope = UUID(); accountEpoch = scope
        do { _ = try await api.request("/auth/logout", method: "POST", body: .object([:])) }
        catch { if scope == accountEpoch { message = "Signed out on this device. The server session could not be ended; it will expire automatically." } }
        guard scope == accountEpoch else { return }
        OfflineIdentityStorage.clear(); api.clearSession(); uploads.reset(); songCommands.reset(); me = nil; computers = []; selectedComputer = ""; loadDrafts(""); loading = false
    }
}
