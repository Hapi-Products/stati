import SwiftUI

@MainActor @Observable final class GroupEditorModel {
    var draft: GroupEditDraft
    private(set) var members: [APIRecord] = []
    private(set) var busy = false
    private(set) var message = ""
    private(set) var canManage = false
    private(set) var conflict = false
    private(set) var completed = false
    private(set) var ready = false
    @ObservationIgnored private let groups: WorshipGroupsModel
    @ObservationIgnored private let store: AppStore
    @ObservationIgnored private let storage = GroupDraftStorage()
    init(draft: GroupEditDraft, groups: WorshipGroupsModel, store: AppStore) { self.draft = draft; self.groups = groups; self.store = store }
    var canSave: Bool { ready && canManage && groups.active && !busy && !conflict && draft.pending == nil && !draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    func load() async {
        guard groups.active else { return }; busy = true
        defer { busy = false }
        do {
            var current: JSONValue?
            if draft.revision != nil { current = try await groups.detail(draft.id) }
            canManage = current?["canManage"].flag ?? groups.canCreate
            guard canManage else { throw APIError(status: 403, message: "Only this group’s leader or an administrator can change its members.") }
            let candidates = try await groups.candidates()
            guard groups.active else { return }
            var known = candidates + (current?["members"].records ?? [])
            if let person = store.me { known.append(APIRecord(raw: ["id": .string(person.id), "name": .string(person.personName), "photoUrl": person["photoUrl"]])) }
            for (id, name) in draft.memberNames ?? [:] where draft.memberIDs.contains(id) { known.append(APIRecord(raw: ["id": .string(id), "name": .string(name)])) }
            var seen: Set<String> = []
            members = known.filter { seen.insert($0.id).inserted }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
            draft.memberIDs.insert(draft.groupOwnerID)
            if let current, draft.pending == nil, current["revision"].number > Double(draft.revision ?? 0) { conflict = true; message = "The saved group changed. Your membership draft is kept." }
            try storage.save(draft); ready = true
            busy = false
            if draft.pending != nil { await reconcile() }
        } catch { message = error.localizedDescription }
    }
    func toggle(_ member: APIRecord) {
        guard canManage, groups.active, !busy, draft.pending == nil, member.id != draft.groupOwnerID else { return }
        if draft.memberIDs.contains(member.id) { draft.memberIDs.remove(member.id) }
        else if draft.memberIDs.count < 101 { draft.memberIDs.insert(member.id); draft.memberNames = (draft.memberNames ?? [:]).merging([member.id: member.name]) { _, new in new } }
        persist()
    }
    func persist() {
        guard groups.active, !busy, draft.pending == nil else { return }
        do { try storage.save(draft); if !conflict { message = "" }; ready = true }
        catch { ready = false; message = error.localizedDescription }
    }
    func save() async {
        guard canSave else { return }; busy = true
        defer { busy = false }
        do {
            let intent = try draft.freeze(); try storage.save(draft)
            _ = try await groups.save(intent)
            guard groups.active else { return }
            try storage.remove(draft); completed = true
        } catch { if groups.active { message = error.localizedDescription + " The same request is kept on this device. Check the saved group before retrying." } }
    }
    func reconcile() async {
        guard groups.active, !busy, let intent = draft.pending else { return }; busy = true
        defer { busy = false }
        do {
            let current = try await groups.detail(intent.id)
            guard groups.active else { return }
            if intent.revision == nil {
                // The read proved this ID exists. Replay the exact creation to verify its stored fingerprint, never a new ID.
                _ = try await groups.save(intent); try storage.remove(draft); completed = true
            } else if current["revision"].number == Double(intent.revision!) {
                draft.allowCorrection(); try storage.save(draft, replacingResolved: intent); message = "The membership change was not saved. Check the details and save again."
            } else if current["name"].text == intent.name && Set(current["members"].records.map(\.id)) == Set(intent.memberIDs + [intent.groupOwnerID]) {
                try storage.remove(draft); await groups.load(); completed = true
            } else { conflict = true; message = "This group changed after your request. Your draft is kept; choose the saved version to continue." }
        } catch let error as APIError where error.status == 404 && intent.revision == nil {
            guard groups.active else { return }
            do { draft.allowCorrection(); try storage.save(draft, replacingResolved: intent); message = "The group was not created. Check the details and save again." }
            catch { message = error.localizedDescription }
        } catch { if groups.active { message = error.localizedDescription + " The original request is still kept here." } }
    }
    func useSavedVersion() async {
        guard groups.active, !busy else { return }; busy = true
        defer { busy = false }
        do {
            let current = try await groups.detail(draft.id)
            guard groups.active, current["canManage"].flag, let revision = Int(exactly: current["revision"].number) else { return }
            var next = GroupEditDraft(ownerID: draft.ownerID, id: draft.id, groupOwnerID: current["ownerId"].text, revision: revision)
            next.name = current["name"].text; next.memberIDs = Set(current["members"].records.map(\.id)); next.memberNames = Dictionary(uniqueKeysWithValues: current["members"].records.map { ($0.id, $0.name) })
            try storage.save(next, replacingResolved: draft.pending); draft = next; conflict = false; message = ""; ready = true
        } catch { message = error.localizedDescription }
    }
}
