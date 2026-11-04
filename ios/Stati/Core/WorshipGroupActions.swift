import SwiftUI

@MainActor @Observable final class WorshipGroupActions {
    var draft: GroupEditDraft?
    private(set) var drafts: [GroupEditDraft] = []
    private(set) var message = ""
    private let groups: WorshipGroupsModel
    private let store: AppStore
    private let storage = GroupDraftStorage()
    init(store: AppStore, groups: WorshipGroupsModel) { self.store = store; self.groups = groups }
    func loadDrafts() {
        guard groups.active, let owner = store.me?.id else { drafts = []; return }
        do { drafts = try storage.load(ownerID: owner); message = "" }
        catch { message = error.localizedDescription }
    }
    func create() {
        guard groups.active, groups.canCreate, let owner = store.me?.id else { return }
        loadDrafts(); guard message.isEmpty else { return }
        draft = drafts.first { $0.revision == nil } ?? GroupEditDraft(ownerID: owner)
    }
    func edit(_ id: String) async {
        loadDrafts(); guard groups.active, message.isEmpty, let owner = store.me?.id else { return }
        if let saved = drafts.first(where: { $0.id == id }) { draft = saved; return }
        do {
            let value = try await groups.detail(id)
            guard groups.active, value["canManage"].flag, let revision = Int(exactly: value["revision"].number) else { return }
            var edit = GroupEditDraft(ownerID: owner, id: id, groupOwnerID: value["ownerId"].text, revision: revision)
            edit.name = value["name"].text; edit.memberIDs = Set(value["members"].records.map(\.id))
            edit.memberNames = value["members"].records.reduce(into: [:]) { $0[$1.id] = $1.name }
            draft = edit
        } catch { if groups.active { message = error.localizedDescription } }
    }
    func finished() async { draft = nil; loadDrafts(); await groups.load() }
}
