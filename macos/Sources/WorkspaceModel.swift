import SwiftUI
import Observation

struct StationProfile: Identifiable {
    let id: String
    let name: String
    let isAdministrator: Bool
    let requiresUnlock: Bool
    let hasPhoto: Bool
    let initials: String

    init?(_ member: JSONValue) {
        let firstName = member["first_name"].string.trimmingCharacters(in: .whitespacesAndNewlines)
        let lastInitial = member["last_initial"].string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !member.id.isEmpty, !firstName.isEmpty, UUID(uuidString: firstName) == nil,
              !["pastor", "commenter"].contains(member["ministryRole"].string) else { return nil }
        id = member.id
        name = lastInitial.isEmpty ? firstName : "\(firstName) \(lastInitial)."
        isAdministrator = member["role"].string == "admin"
        requiresUnlock = member["requiresUnlock"].bool
        hasPhoto = member["has_photo"].bool || member["has_photo"].number == 1
        initials = String(firstName.prefix(1) + lastInitial.prefix(1)).uppercased()
    }
}

@MainActor @Observable
final class WorkspaceModel {
    let engine: EngineClient
    init(engine: EngineClient = EngineClient()) { self.engine = engine }
    var station: JSONValue = .null
    var status: JSONValue = .null
    var rows: [JSONValue] = []
    var selection: String?
    var destination: Destination = .station
    var search = ""
    var error = ""
    var notice = ""
    var refreshing = false
    private var refreshRequested = false
    private var privateEpoch = 0
    private var retainedDrafts: [String: (title: String, lyrics: String, lines: Int)] = [:]
    var working = false
    var connected = false
    private(set) var connecting = false
    @ObservationIgnored private var engineEvents: Task<Void, Never>?
    var pairing: JSONValue = .null
    var invitation: JSONValue = .null
    var preview: JSONValue = .null
    var showInspector = false
    var showProfile = false
    var showInvitation = false
    var name = Host.current().localizedName ?? "Mac"
    private(set) var pendingProfile: StationProfile?
    private(set) var awaitingPhone = false
    private(set) var awaitingAdministrator = false
    private(set) var pairingKnown = false
    private(set) var unlock: JSONValue = .null
    private(set) var profileError = ""
    @ObservationIgnored private var profileApprovalTask: Task<Void, Never>?
    var title = ""
    var lyrics = ""
    var lines = 4
    var slides: [JSONValue] = []
    var draftLoaded = false
    var draftDirty = false
    private(set) var draftSaving = false
    @ObservationIgnored private var draftSaveTask: Task<Void, Never>?
    private var draftSaveRequested = false
    var draftOwner = ""
    var prepareScope = 0
    var service: JSONValue = .null
    var details: JSONValue = .null
    var libraryOffset = 0
    var libraryTotal = 0
    var favoritesOnly = false
    var libraryText = ""
    var librarySong: JSONValue = .null
    var libraryDirty = false
    var serviceTitle = ""
    var serviceDate = Date()
    var showNewService = false

    var paired: Bool { station["paired"].bool }
    var unlocked: Bool { paired && !status["locked"].bool && !status["operatorId"].string.isEmpty }
    var profileOptions: [StationProfile] { station["members"].array.compactMap(StationProfile.init) }
    var currentProfile: StationProfile? { profileOptions.first { $0.id == status["operatorId"].string } }
    var supportsAssistedSignIn: Bool { station["assistedSignIn"].bool }
    var operatorName: String { currentProfile?.name ?? "Choose your profile" }
    private var choosingProfile: Bool { !status["locked"].bool && paired && (showProfile || !unlocked) }
    var capabilities: JSONValue { status["capabilities"] }
    var visibleRows: [JSONValue] { destination == .station && !search.isEmpty ? rows.filter { ($0.displayName + $0["sender_name"].string).localizedCaseInsensitiveContains(search) } : rows }
    var selectedRow: JSONValue { rows.first { $0.id == selection } ?? .null }

    func boot() async {
        guard engineEvents == nil else { return }
        await retryConnection()
    }

    func retryConnection() async {
        guard !connecting else { return }
        if connected { await refresh(); return }

        connecting = true
        error = ""
        defer { connecting = false }
        if engineEvents == nil {
            let events = await engine.events()
            engineEvents = Task { [weak self] in
                for await event in events {
                    guard let self else { return }
                    guard event == "workspace-reset" || event == "engine-stopped" else { continue }
                    if self.pendingProfile != nil {
                        self.profileError = "This sign-in ended. Choose your profile to try again."
                    }
                    self.invalidatePrivateState()
                    self.resetProfileSelection()
                    self.status = .object(["locked": .bool(true)])
                    self.station = .object(["paired": .bool(self.paired)])
                    if event == "engine-stopped" {
                        self.error = "The Stați engine disconnected. Choose Retry to reconnect."
                        self.connected = false
                    } else {
                        await self.refresh()
                    }
                }
            }
        }

        do {
            try await engine.prepareRetry()
            var access = try await engine.call("access-status", args: [.bool(true)])
            if access["protectedStorage"].string == "loading" {
                try await Task.sleep(for: .milliseconds(300))
                access = try await engine.call("access-status")
            }
            guard access["allowed"].bool else {
                error = access["protectedStorage"].string == "loading"
                    ? "Stați is waiting for protected pairing. If macOS asks for Keychain access, respond to the prompt, then choose Retry."
                    : "Stați could not open the saved pairing. Unlock your macOS Keychain and choose Retry."
                return
            }
            connected = true
            await refresh()
        } catch is CancellationError {
            return
        } catch {
            self.error = error.localizedDescription
        }
    }

    func invalidatePrivateState() {
        privateEpoch += 1
        if draftDirty, !draftOwner.isEmpty { retainedDrafts[draftOwner] = (title, lyrics, lines) }
        prepareScope += 1
        rows = []; selection = nil; preview = .null; details = .null; service = .null
        lyrics = ""; title = ""; slides = []; draftLoaded = false; draftDirty = false; draftOwner = ""
        librarySong = .null; libraryText = ""; libraryDirty = false
    }
    private func resetProfileSelection() {
        profileApprovalTask?.cancel()
        profileApprovalTask = nil
        unlock = .null
        pendingProfile = nil
        awaitingPhone = false
        awaitingAdministrator = false
    }
    func refresh() async {
        guard connected, !working else { return }
        guard !refreshing else { refreshRequested = true; return }
        refreshing = true
        var epoch = privateEpoch
        defer {
            refreshing = false
            if refreshRequested { refreshRequested = false; Task { await refresh() } }
        }
        do {
            let oldOperator = status["operatorId"].string
            let nextStatus = try await engine.call("native-status")
            guard epoch == privateEpoch else { refreshRequested = true; return }
            status = nextStatus
            if status["locked"].bool {
                invalidatePrivateState()
                resetProfileSelection()
                station = .object(["paired": .bool(paired)])
                return
            }
            if oldOperator != status["operatorId"].string { invalidatePrivateState() }
            epoch = privateEpoch
            let nextStation = try await engine.call("state")
            guard epoch == privateEpoch else { refreshRequested = true; return }
            station = nextStation
            pairingKnown = true
            if !paired { resetProfileSelection(); showProfile = false }
            if !unlocked { rows = []; error = ""; return }
            switch destination {
            case .station: rows = station["transfers"].array
            case .library:
                let result = try await engine.call("song-library-search", args: [.object(["query": .string(search), "language": .string("all"), "offset": .number(Double(libraryOffset)), "favoritesOnly": .bool(favoritesOnly)])])
                guard epoch == privateEpoch else { return }
                rows = result["items"].array; libraryTotal = Int(result["total"].number)
            case .services:
                let plans = try await engine.call("service-plans-list").array
                guard epoch == privateEpoch else { return }
                rows = plans
            case .prepare:
                if !draftLoaded {
                    let saved = try await engine.call("prepare-draft-load")["draft"]
                    // Drafts are scoped to an explicitly chosen profile.
                    guard epoch == privateEpoch else { return }
                    if saved != .null { lyrics = saved["text"].string; title = saved["title"].string; lines = max(2, Int(saved["lines"].number)) }
                    draftOwner = status["operatorId"].string
                    if let retained = retainedDrafts.removeValue(forKey: draftOwner) { title = retained.title; lyrics = retained.lyrics; lines = retained.lines; draftDirty = true }
                    else { draftDirty = false }
                    draftLoaded = true
                }
            case .clocks, .settings, .tasks, .groups: break
            }
            error = ""
        } catch { self.error = error.localizedDescription }
    }
    func run(_ action: @MainActor () async throws -> Void) async {
        guard !working else { return }
        working = true; error = ""; notice = ""
        do { try await action() } catch { self.error = error.localizedDescription }
        working = false
    }
    func command(_ method: String, _ args: [JSONValue] = [], message: String = "") async {
        await run { _ = try await engine.call(method, args: args); notice = message }
        await refresh()
    }
    func startPairing() async { await run { pairing = try await engine.call("pair", args: [.string(name)]) }; await refresh() }
    func checkPairing() async { await command("pair-status"); if paired { pairing = .null } }
    func chooseProfile(_ profile: StationProfile) async {
        guard choosingProfile, !working, pendingProfile == nil,
              profileOptions.contains(where: { $0.id == profile.id }) else { return }
        profileError = ""
        if profile.id == currentProfile?.id {
            showProfile = false
            return
        }
        pendingProfile = profile
        if profile.isAdministrator { return }
        if !profile.requiresUnlock {
            await completeDirectSignIn()
        } else if !supportsAssistedSignIn {
            await requestPhoneSignIn()
        }
    }

    func submitPIN(_ pin: String) async {
        guard pendingProfile?.isAdministrator == true, !awaitingPhone,
              pin.utf8.count == 4, pin.utf8.allSatisfy({ (48...57).contains($0) }) else { return }
        await completeDirectSignIn(pin: pin)
    }

    private func completeDirectSignIn(pin: String? = nil) async {
        guard let profile = pendingProfile, await prepareProfileSignIn(profile) else { return }
        let epoch = privateEpoch
        do {
            var input: [String: JSONValue] = ["id": .string(profile.id)]
            if let pin { input["pin"] = .string(pin) }
            _ = try await engine.call("operator", args: [.object(input)])
            guard isCurrentSignIn(profile, epoch: epoch) else { working = false; return }
            try await openApprovedProfile(profile, epoch: epoch)
        } catch {
            if isCurrentSignIn(profile, epoch: epoch) { profileError = error.localizedDescription }
            if !profile.isAdministrator { resetProfileSelection() }
        }
        working = false
        await refresh()
    }

    func requestPhoneSignIn(backupCode: String? = nil) async {
        guard let profile = pendingProfile, !awaitingPhone, await prepareProfileSignIn(profile) else { return }
        awaitingPhone = true
        awaitingAdministrator = backupCode != nil
        let epoch = privateEpoch
        do {
            var arguments: [JSONValue] = [.string(profile.id)]
            if let backupCode { arguments.append(.string(backupCode)) }
            let request = try await engine.call("operator-unlock", args: arguments)
            guard isCurrentSignIn(profile, epoch: epoch) else { working = false; return }
            let token = request["token"].string
            guard !token.isEmpty, !request["qr"].string.isEmpty, request["expiresAt"].number > 0 else {
                throw EngineFailure(message: "The sign-in code could not be prepared. Try again.")
            }
            unlock = request
            profileApprovalTask = Task { [weak self] in await self?.waitForProfileApproval(token: token) }
        } catch {
            if isCurrentSignIn(profile, epoch: epoch) {
                if backupCode == nil {
                    await endPendingProfile(message: error.localizedDescription)
                } else {
                    awaitingPhone = false
                    awaitingAdministrator = false
                    profileError = error.localizedDescription
                    _ = try? await engine.call("operator-unlock-cancel")
                }
            }
        }
        working = false
        await refresh()
    }

    private func prepareProfileSignIn(_ profile: StationProfile) async -> Bool {
        guard choosingProfile, !working, pendingProfile?.id == profile.id else { return false }
        if draftDirty {
            await saveDraft()
            guard choosingProfile, !working, pendingProfile?.id == profile.id else { return false }
            guard !draftDirty else {
                profileError = "Your current draft could not be saved. Save it before switching profiles."
                return false
            }
        }
        invalidatePrivateState()
        status = .object(["locked": .bool(false)])
        station = .object(["paired": .bool(paired), "members": station["members"], "assistedSignIn": station["assistedSignIn"]])
        profileError = ""
        working = true
        return true
    }

    private func isCurrentSignIn(_ profile: StationProfile, epoch: Int) -> Bool {
        choosingProfile && epoch == privateEpoch && pendingProfile?.id == profile.id
    }

    private func openApprovedProfile(_ profile: StationProfile, epoch: Int) async throws {
        _ = try await engine.call("workspace-open")
        guard isCurrentSignIn(profile, epoch: epoch) else { throw CancellationError() }
        profileApprovalTask = nil
        resetProfileSelection()
        showProfile = false
    }

    private func waitForProfileApproval(token: String) async {
        guard let profile = pendingProfile else { return }
        let epoch = privateEpoch
        while !Task.isCancelled, choosingProfile, unlock["token"].string == token {
            do {
                let result = try await engine.call("operator-unlock-status", args: [.string(token)])
                guard !Task.isCancelled, choosingProfile, unlock["token"].string == token else { return }
                if result["approved"].bool {
                    working = true
                    do { try await openApprovedProfile(profile, epoch: epoch) }
                    catch { working = false; throw error }
                    working = false
                    await refresh()
                    return
                }
                try await Task.sleep(for: .seconds(2))
            } catch is CancellationError { return }
            catch {
                guard choosingProfile, unlock["token"].string == token else { return }
                profileApprovalTask = nil
                await endPendingProfile(message: error.localizedDescription)
                return
            }
        }
    }

    func endPendingProfile(message: String = "") async {
        let cancelPhone = awaitingPhone
        let wasWorking = working
        // An approval poll can reach the engine before cancellation. Invalidate
        // the visible request immediately, then revoke the pending engine choice.
        resetProfileSelection()
        profileError = message
        if cancelPhone {
            working = true
            _ = try? await engine.call("operator-unlock-cancel")
            working = wasWorking
            await refresh()
        }
    }

    func dismissProfile() async {
        guard !showProfile else { return }
        await endPendingProfile()
    }

    func loadSelection() async {
        guard let id = selection, unlocked else { return }
        let scope = status["operatorId"].string
        let page = destination
        await run {
            let value: JSONValue
            switch page {
            case .station: value = try await engine.call("file-preview", args: [.string(id)])
            case .library: value = try await engine.call("song-library-open", args: [.string(id)])
            case .services: value = selectedRow
            default: return
            }
            guard scope == status["operatorId"].string, selection == id, page == destination else { return }
            if page == .library { librarySong = value; libraryText = value["text"].string; libraryDirty = false }
            else if page == .services { service = value; details = .null }
            else { preview = value }
            showInspector = true
        }
    }
    func showInvite() async {
        await run { invitation = try await engine.call("enrollment-code"); showInvitation = true }
    }
    private var draftSnapshot: PrepareDraftSnapshot {
        PrepareDraftSnapshot(owner: draftOwner, epoch: privateEpoch, title: title, text: lyrics, lines: lines)
    }
    func saveDraft() async {
        guard draftLoaded, !draftOwner.isEmpty, draftOwner == status["operatorId"].string else { return }
        draftSaveRequested = true
        if let task = draftSaveTask { await task.value; return }
        let task = Task { await drainDraftSaves() }
        draftSaveTask = task
        await task.value
        draftSaveTask = nil
        // A newly authorized owner's request may have joined a prior owner's write.
        if draftSaveRequested, draftDirty { await saveDraft() }
    }
    private func drainDraftSaves() async {
        draftSaving = true
        defer { draftSaving = false }
        while draftSaveRequested {
            guard draftLoaded, !draftOwner.isEmpty, draftOwner == status["operatorId"].string else { return }
            draftSaveRequested = false
            let snapshot = draftSnapshot
            do {
                _ = try await engine.call("prepare-draft-save", args: [snapshot.payload])
                guard privateEpoch == snapshot.epoch, draftOwner == snapshot.owner,
                      status["operatorId"].string == snapshot.owner else { return }
                if draftSnapshot == snapshot {
                    draftDirty = false
                    draftSaveRequested = false
                    notice = "Draft saved on this computer."
                } else {
                    // The acknowledged write contains an older editor value. Keep the
                    // latest value dirty and drain it even if another autosave was canceled.
                    draftDirty = true
                    draftSaveRequested = true
                }
            } catch {
                if privateEpoch == snapshot.epoch, draftOwner == snapshot.owner {
                    draftDirty = true
                    self.error = error.localizedDescription
                    // A failed write retains this owner's draft for an explicit retry.
                    draftSaveRequested = false
                }
                // Keep a queued replacement owner's request when the old scope failed.
                return
            }
        }
    }
    func previewSlides() async {
        await run { slides = try await engine.call("prepare-slides", args: [.object(["text": .string(lyrics), "lines": .number(Double(lines))])]).array }
    }
    func exportSlides(_ method: String) async {
        await run {
            let parsed = try await engine.call("prepare-slides", args: [.object(["text": .string(lyrics), "lines": .number(Double(lines))])])
            slides = parsed.array
            guard !slides.isEmpty else { throw EngineFailure(message: "Enter lyrics before exporting.") }
            let data: JSONValue = .object(["title": .string(String((slides.first?["text"].string.components(separatedBy: "\n").first ?? "Presentation").prefix(180))), "songName": .string(title), "language": .string("auto"), "fontSize": .number(96), "amenFontSize": .number(48), "linesPerSlide": .number(Double(lines)), "slides": parsed])
            let result = try await engine.call(method, args: [data])
            if result["canceled"].bool { return }
            guard !result["path"].string.isEmpty else { throw EngineFailure(message: "The export could not be confirmed.") }
            notice = "Saved \(result["path"].string)"
        }
    }
    func serviceAction(_ type: String) async {
        guard !service.id.isEmpty else { return }
        let leadership = service["leadership"]
        await command("service-plans-change", [.object(["type": .string(type), "id": .string(service.id), "expectedRevision": service["revision"], "expectedLeadershipRevision": leadership["revision"]])])
        service = rows.first { $0.id == service.id } ?? .null
    }
}
