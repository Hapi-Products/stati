import SwiftUI

struct WorshipGroupsManagementView: View {
    @Environment(AppStore.self) private var store
    let groups: WorshipGroupsModel
    @State private var pendingRemoval: APIRecord?
    @State private var actions: WorshipGroupActions
    init(store: AppStore, groups: WorshipGroupsModel) { self.groups = groups; _actions = State(initialValue: WorshipGroupActions(store: store, groups: groups)) }
    var body: some View {
        List {
            Section {
                ForEach(groups.groups) { group in
                    if group["canManage"].flag {
                        Button { Task { await actions.edit(group.id) } } label: {
                            Label {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(group.name).foregroundStyle(.primary)
                                    Text("Edit name and members").font(.footnote).foregroundStyle(.secondary)
                                }
                            } icon: { Image(systemName: "pencil") }
                        }
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
                } header: { Text("Drafts") } footer: {
                    Text("Drafts are saved on this device. Open one to finish editing or check an interrupted save.")
                }
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
