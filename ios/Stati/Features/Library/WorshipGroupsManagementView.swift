import SwiftUI

struct WorshipGroupsManagementView: View {
    @Environment(AppStore.self) private var store
    let groups: WorshipGroupsModel
    @State private var pendingRemoval: APIRecord?
    @State private var actions: WorshipGroupActions
    init(store: AppStore, groups: WorshipGroupsModel) { self.groups = groups; _actions = State(initialValue: WorshipGroupActions(store: store, groups: groups)) }
    var body: some View {
        List {
            if !actions.drafts.isEmpty {
                Section {
                    ForEach(actions.drafts) { draft in
                        Button { actions.draft = draft } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(draft.name.isEmpty ? "Untitled group edit" : draft.name)
                                Text(draft.pending == nil ? "Continue editing on this device" : "Check interrupted save").font(.footnote).foregroundStyle(.secondary)
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                } header: { Text("Unfinished group edits") } footer: {
                    Text("Group names and member edits saved only on this device. Reopen a draft to finish an edit or check the status of an interrupted save.")
                }
            }
            Section {
                ForEach(groups.groups) { group in
                    if group["canManage"].flag {
                        Button(group.name, systemImage: "person.2") { Task { await actions.edit(group.id) } }
                            .swipeActions(allowsFullSwipe: false) {
                                Button("Remove", systemImage: "trash", role: .destructive) { pendingRemoval = group }
                            }
                            .contextMenu {
                                Button("Remove group", systemImage: "trash", role: .destructive) { pendingRemoval = group }
                            }
                    }
                    else { Label(group.name, systemImage: "person.2") }
                }
                if groups.loaded && groups.groups.isEmpty { Text("No groups yet").foregroundStyle(Color.statiSecondary) }
                if groups.loading { ProgressView("Loading groups…") }
            }
            NoticeView(text: groups.message); NoticeView(text: actions.message); NoticeView(text: groups.removalMessage)
        }.navigationTitle("Worship groups").navigationBarTitleDisplayMode(.inline)
            .toolbar { if groups.canCreate { Button("New group", systemImage: "plus", action: actions.create).labelStyle(ActionIconLabelStyle()) } }
            .disabled(groups.removing)
            .alert("Remove worship group?", isPresented: Binding(
                get: { pendingRemoval != nil },
                set: { if !$0 { pendingRemoval = nil } }
            ), presenting: pendingRemoval) { group in
                Button("Remove group", role: .destructive) { Task { await remove(group) } }
                Button("Cancel", role: .cancel) {}
            } message: { group in
                Text("Members will lose access to \(group.name) and its shared files. Stați keeps the saved records.")
            }
            .sheet(item: $actions.draft, onDismiss: actions.loadDrafts) { draft in WorshipGroupEditorView(store: store, groups: groups, draft: draft) { Task { await actions.finished() } } }
            .task { await groups.load(); actions.loadDrafts() }.refreshable { await groups.load(); actions.loadDrafts() }
    }

    private func remove(_ group: APIRecord) async {
        try? await groups.remove(group)
    }
}
