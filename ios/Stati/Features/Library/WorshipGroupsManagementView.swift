import SwiftUI

struct WorshipGroupsManagementView: View {
    @Environment(AppStore.self) private var store
    let groups: WorshipGroupsModel
    @State private var actions: WorshipGroupActions
    init(store: AppStore, groups: WorshipGroupsModel) { self.groups = groups; _actions = State(initialValue: WorshipGroupActions(store: store, groups: groups)) }
    var body: some View {
        List {
            if !actions.drafts.isEmpty { Section("On this device") { ForEach(actions.drafts) { draft in Button(draft.name.isEmpty ? "Continue new group" : draft.name, systemImage: draft.pending == nil ? "pencil" : "arrow.clockwise") { actions.draft = draft } } } }
            Section {
                ForEach(groups.groups) { group in
                    if group["canManage"].flag { Button(group.name, systemImage: "person.2") { Task { await actions.edit(group.id) } } }
                    else { Label(group.name, systemImage: "person.2") }
                }
                if groups.loaded && groups.groups.isEmpty { Text("No groups yet").foregroundStyle(Color.statiSecondary) }
                if groups.loading { ProgressView("Loading groups…") }
            }
            NoticeView(text: groups.message); NoticeView(text: actions.message)
        }.navigationTitle("Worship groups").navigationBarTitleDisplayMode(.inline)
            .toolbar { if groups.canCreate { Button("New group", systemImage: "plus", action: actions.create).labelStyle(ActionIconLabelStyle()) } }
            .sheet(item: $actions.draft, onDismiss: actions.loadDrafts) { draft in WorshipGroupEditorView(store: store, groups: groups, draft: draft) { Task { await actions.finished() } } }
            .task { await groups.load(); actions.loadDrafts() }.refreshable { await groups.load(); actions.loadDrafts() }
    }
}
