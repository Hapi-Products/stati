import SwiftUI

@MainActor @Observable
final class ServiceEditor {
    var plan: APIRecord
    var saving = false
    var message = ""
    var failed = false
    var changingLeader = false
    var leadershipNotice = ""
    private let fetch: @MainActor (String) async throws -> JSONValue
    private let store: AppStore
    private let ownerID: String
    private let epoch: UUID
    private var active: Bool { store.me?.id == ownerID && store.accountEpoch == epoch && store.api.signedIn && store.selectedComputer == computerID }
    let computerID: String
    private var debounce: Task<Void, Never>?
    private var resave = false
    init(store: AppStore, computerID: String, plan: APIRecord, offline: Bool = false, request: (@MainActor (String) async throws -> JSONValue)? = nil) {
        fetch = request ?? { try await store.api.request($0) }
        self.store = store; self.computerID = computerID; ownerID = store.me?.id ?? ""; epoch = store.accountEpoch
        self.plan = offline ? plan : store.serviceDrafts[plan.id].map { APIRecord(raw: $0) } ?? plan
    }
    var canEdit: Bool { plan["leadership"]["canEdit"].flag || (plan["leadership"] == .null && store.canPlan) }
    var title: String { get { plan.title } set { plan["title"] = .string(newValue); changed() } }
    var notes: String { get { plan["notes"].text } set { plan["notes"] = .string(newValue); changed() } }
    var schedule: Date {
        get { ServiceSchedule.read(date: plan["date"].text, time: plan["time"].text) }
        set { plan["date"] = .string(ServiceSchedule.date(newValue)); plan["time"] = .string(ServiceSchedule.time(newValue)); changed() }
    }
    var songs: [APIRecord] { plan["songs"].records }
    private var path: String { "/computers/" + computerID + "/services" }
    func changed() {
        guard active else { return }
        store.serviceDrafts[plan.id] = plan.raw
        if saving { resave = true; return }
        debounce?.cancel(); debounce = Task { do { try await Task.sleep(for: .milliseconds(500)); await save() } catch { } }
    }
    func move(from: IndexSet, to: Int) { guard canEdit else { return }; var rows = plan["songs"].items; rows.move(fromOffsets: from, toOffset: to); plan["songs"] = .array(rows); changed() }
    func remove(_ id: String) { guard canEdit else { return }; plan["songs"] = .array(plan["songs"].items.filter { $0["id"].text != id }); changed() }
    func add(_ song: APIRecord) {
        guard active, canEdit else { return }
        guard songs.count < 1000 else { message = "A service can hold up to 1,000 songs."; return }
        plan["songs"] = .array(plan["songs"].items + [.object(["id": .string(UUID().uuidString.lowercased()), "songId": .string(song.id), "title": .string(song.title), "filename": song["filename"], "contentHash": song["contentHash"], "reviewed": .bool(false)])]); changed()
    }
    func save() async {
        guard active, store.serviceDrafts[plan.id] != nil, canEdit, !saving, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        saving = true; failed = false; resave = false; let sent = plan
        do {
            let result = try await store.api.request(path, method: "POST", body: .object(["type": .string("save"), "id": .string(plan.id), "plan": sent.value]))
            guard active else { saving = false; return }
            guard let saved = result["plans"].records.first(where: { $0.id == plan.id }) else { throw APIError(status: 409, message: "The service save could not be confirmed. Your draft is kept.") }
            if plan == sent { plan = saved; store.serviceDrafts.removeValue(forKey: plan.id) }
            else { plan["revision"] = saved["revision"]; plan["leadership"] = saved["leadership"]; store.serviceDrafts[plan.id] = plan.raw; resave = true }
            store.servicesChanged(computerID: computerID)
            message = "Saved"; saving = false
            if resave { changed() }
        } catch { saving = false; failed = true; message = error.localizedDescription + " Your draft is kept." }
    }
    func refresh() async {
        guard active, !saving, !changingLeader, store.serviceDrafts[plan.id] == nil else { return }
        let id = plan.id, revision = plan["revision"].number
        do {
            let response = try await fetch(path)
            try Task.checkCancellation(); guard active, !saving, !changingLeader, plan.id == id, store.serviceDrafts[id] == nil else { return }
            guard let saved = response["plans"].records.first(where: { $0.id == id }), saved["revision"].number >= max(revision, plan["revision"].number), saved["leadership"]["revision"].number >= plan["leadership"]["revision"].number else { return }
            if plan["leadership"]["isLeader"].flag, !saved["leadership"]["isLeader"].flag,
               !saved["leadership"]["leaderLabel"].text.isEmpty {
                leadershipNotice = saved["leadership"]["leaderLabel"].text + " took over " + saved.title + "."
            }
            plan = saved
            message = ""
        } catch is CancellationError { }
        catch { if active { message = error.localizedDescription } }
    }
    func leadership(_ type: String) async {
        guard active, !saving, !changingLeader else { return }
        changingLeader = true
        defer { changingLeader = false }
        if store.serviceDrafts[plan.id] != nil {
            await save()
            guard active, store.serviceDrafts[plan.id] == nil else { return }
        }
        let id = plan.id
        var body: [String: JSONValue] = ["type": .string(type), "id": .string(id), "expectedRevision": plan["revision"], "expectedLeadershipRevision": plan["leadership"]["revision"]]
        if type == "claim-leadership", plan["leadership"]["canTakeOver"].flag { body["takeOver"] = .bool(true) }
        do {
            let result = try await store.api.request(path, method: "POST", body: .object(body))
            guard active else { return }
            guard let saved = result["plans"].records.first(where: { $0.id == id }) else {
                throw APIError(status: 409, message: "Couldn’t confirm the leadership change. Refresh the service.")
            }
            plan = saved
            store.servicesChanged(computerID: computerID)
            message = ""
        } catch {
            if active { message = error.localizedDescription }
        }
    }
}
