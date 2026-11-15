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
                Section("Group name") {
                    TextField("Group name", text: $model.draft.name)
                        .disabled(model.busy || model.draft.pending != nil || !model.canManage)
                        .onChange(of: model.draft.name) { model.persist() }
                }
                Section("In this group") {
                    ForEach(matchingPeople.filter { model.draft.memberIDs.contains($0.id) }, content: memberRow)
                    if model.busy { ProgressView("Checking group…") }
                }
                let candidates = matchingPeople.filter { !model.draft.memberIDs.contains($0.id) }
                if !candidates.isEmpty {
                    Section("Available to add") { ForEach(candidates, content: memberRow) }
                }
                if !model.message.isEmpty { Section { NoticeView(text: model.message) } }
                if model.draft.pending != nil { Section { Button("Check saved group", systemImage: "arrow.clockwise") { Task { await model.reconcile() } }.disabled(model.busy) } }
                if model.conflict { Section { Button("Use saved version", systemImage: "arrow.counterclockwise") { reloading = true }.disabled(model.busy) } }
            }.contentMargins(.top, 8, for: .scrollContent).navigationTitle(model.draft.revision == nil ? "New group" : "Edit group").navigationBarTitleDisplayMode(.inline)
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

    private var matchingPeople: [APIRecord] {
        model.members.filter { query.isEmpty || $0.name.localizedStandardContains(query) }
    }

    private func memberRow(_ member: APIRecord) -> some View {
        let selected = model.draft.memberIDs.contains(member.id)
        let leader = member.id == model.draft.groupOwnerID
        return Button { model.toggle(member) } label: {
            HStack(spacing: 12) {
                MemberAvatar(api: store.api, path: member["photoUrl"].text, initials: String(member.name.prefix(1)), size: 30)
                Text(member.name).foregroundStyle(.primary)
                Spacer()
                if leader { Text("Group leader").font(.footnote).foregroundStyle(.secondary) }
                else if selected { Image(systemName: "checkmark").foregroundStyle(AppIconAppearance.shared.accent) }
            }
            .frame(minHeight: 44)
        }
        .disabled(model.busy || model.draft.pending != nil || leader || !model.canManage)
        .accessibilityLabel(member.name + (leader ? ", group leader" : selected ? ", selected" : ""))
    }

}
