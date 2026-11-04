import SwiftUI

struct WorshipGroupEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppStore.self) private var store
    @State private var model: GroupEditorModel
    @State private var query = ""
    @State private var reloading = false
    let saved: () -> Void
    init(store: AppStore, groups: WorshipGroupsModel, draft: GroupEditDraft, saved: @escaping () -> Void) { _model = State(initialValue: GroupEditorModel(draft: draft, groups: groups, store: store)); self.saved = saved }
    var body: some View {
        NavigationStack {
            Form {
                Section { TextField("Group name", text: $model.draft.name).disabled(model.busy || model.draft.pending != nil || !model.canManage).onChange(of: model.draft.name) { model.persist() } }
                Section {
                    ForEach(model.members.filter { query.isEmpty || $0.name.localizedStandardContains(query) }) { member in
                        Button { model.toggle(member) } label: {
                            HStack(spacing: 12) {
                                MemberAvatar(api: store.api, path: member["photoUrl"].text, initials: String(member.name.prefix(1)), size: 30)
                                Text(member.name).foregroundStyle(.primary); Spacer()
                                if model.draft.memberIDs.contains(member.id) { Image(systemName: "checkmark").foregroundStyle(AppIconAppearance.shared.accent) }
                            }.frame(minHeight: 44)
                        }.disabled(model.busy || model.draft.pending != nil || member.id == model.draft.groupOwnerID || !model.canManage)
                        .accessibilityLabel(member.name + (member.id == model.draft.groupOwnerID ? ", included" : model.draft.memberIDs.contains(member.id) ? ", selected" : ""))
                    }
                    if model.busy { ProgressView("Checking group…") }
                } header: { Text("Members") } footer: { Text("Members and admins only.") }
                if !model.message.isEmpty { Section { NoticeView(text: model.message) } }
                if model.draft.pending != nil { Section { Button("Check saved group", systemImage: "arrow.clockwise") { Task { await model.reconcile() } }.disabled(model.busy) } }
                if model.conflict { Section { Button("Use saved version", systemImage: "arrow.counterclockwise") { reloading = true }.disabled(model.busy) } }
            }.contentMargins(.top, 8, for: .scrollContent).navigationTitle(model.draft.revision == nil ? "New group" : "Group members").navigationBarTitleDisplayMode(.inline)
                .searchable(text: $query, placement: .toolbar, prompt: "Find a member").searchToolbarBehavior(.minimize)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Close group", systemImage: "xmark") { dismiss() }.labelStyle(ActionIconLabelStyle()).disabled(model.busy) }
                    ToolbarItem(placement: .confirmationAction) { Button("Save group", systemImage: "checkmark") { Task { await model.save() } }.labelStyle(.iconOnly).buttonStyle(.borderedProminent).buttonBorderShape(.circle).disabled(!model.canSave) }
                }
                .confirmationDialog("Use the saved group?", isPresented: $reloading, titleVisibility: .visible) { Button("Replace local draft", role: .destructive) { Task { await model.useSavedVersion() } } } message: { Text("This replaces your local group name and membership choices with the saved version.") }
                .interactiveDismissDisabled(model.busy)
                .task { await model.load() }
                .onChange(of: model.completed) { _, complete in if complete { saved(); dismiss() } }
                .onChange(of: store.accountEpoch) { dismiss() }
        }.presentationSizing(.form)
    }
}
