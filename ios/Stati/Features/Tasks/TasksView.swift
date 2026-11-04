import SwiftUI

struct TasksView: View {
    let active: Bool
    @Environment(AppStore.self) private var store
    var body: some View {
        PhoneTaskBoard(store: store, active: active).id(store.accountEpoch)
    }
}

private struct PhoneTaskBoard: View {
    let store: AppStore
    let active: Bool
    @Environment(\.scenePhase) private var scenePhase
    @State private var model: IPadTasksModel
    @State private var creating = false
    @State private var expanded: Set<String> = ["new", "in-progress"]
    @State private var highlighted = ""
    @State private var moving: APIRecord?
    private let statuses = [("new", "New"), ("in-progress", "In progress"), ("complete", "Complete")]
    init(store: AppStore, active: Bool) {
        self.store = store; self.active = active; _model = State(initialValue: IPadTasksModel(store: store))
        #if DEBUG && targetEnvironment(simulator)
        if NativeReview.route == "tasks-move" { _moving = State(initialValue: APIRecord(raw: NativeReview.task.fields)) }
        #endif
    }
    var body: some View {
        List {
            if model.removed != nil {
                Section { Button("Undo task removal", systemImage: "arrow.uturn.backward") { Task { await model.undo() } } }
            }
            ForEach(statuses, id: \.0) { status, title in
                Section {
                    DisclosureGroup(isExpanded: Binding(get: { expanded.contains(status) }, set: { if $0 { expanded.insert(status) } else { expanded.remove(status) } })) {
                        ForEach(model.tasks.filter { $0["status"].text == status }) { task in
                            NavigationLink(value: task.id) {
                                HStack(alignment: .top, spacing: 12) {
                                    MemberAvatar(api: store.api, path: task["authorPhotoUrl"].text, initials: String(task["authorName"].text.prefix(1)), size: 32).accessibilityHidden(true)
                                    VStack(alignment: .leading, spacing: 6) {
                                        HStack { if task["urgent"].flag { Image(systemName: "flag.fill").foregroundStyle(.red) }; Text(task.title).font(.headline) }
                                        Text(task["body"].text).font(.subheadline).foregroundStyle(Color.statiSecondary).lineLimit(2)
                                        if task["noteCount"].number > 0 { Label("\(Int(task["noteCount"].number))", systemImage: "bubble.right").font(.footnote).foregroundStyle(Color.statiSecondary) }
                                    }
                                }.padding(.vertical, 4)
                            }.draggable(task.id)
                                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                    if task["canDelete"].flag { Button("Delete", systemImage: "trash", role: .destructive) { Task { await model.delete(task) } }.disabled(model.working.contains(task.id)) }
                                }
                                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                                    if task["canManage"].flag { Button("Move", systemImage: "folder") { moving = task }.tint(.accentColor).disabled(model.working.contains(task.id)) }
                                }
                        }
                        if !model.tasks.contains(where: { $0["status"].text == status }) { Text("No tasks here.").foregroundStyle(Color.statiSecondary) }
                    } label: { HStack { Text(title).font(.headline); Text("\(model.tasks.filter { $0["status"].text == status }.count)").foregroundStyle(Color.statiSecondary) }.frame(minHeight: 44) }
                }.listRowBackground(highlighted == status ? AppIconAppearance.shared.accent.opacity(0.15) : Color(.secondarySystemGroupedBackground))
                    .dropDestination(for: String.self) { ids, _ in guard let id = ids.first else { return false }; Task { await model.move(id: id, status: status) }; return true } isTargeted: { highlighted = $0 ? status : "" }
            }
            if model.tasks.count < model.total { Button("Load more tasks") { Task { await model.load(more: true) } } }
            if !model.message.isEmpty { Section { NoticeView(text: model.message) } }
        }.navigationTitle("Tasks").navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("New task", systemImage: "plus") { creating = true }.labelStyle(ActionIconLabelStyle()) }
            .navigationDestination(for: String.self) { id in TaskDetailView(taskID: id) { value in model.removed = value; model.apply(value) } }
            .sheet(isPresented: $creating) { NewTaskView { creating = false } }
            .confirmationDialog("Move task", isPresented: Binding(get: { moving != nil }, set: { if !$0 { moving = nil } }), titleVisibility: .visible) {
                if let moving { ForEach(statuses.filter { $0.0 != moving["status"].text }, id: \.0) { status, title in Button(title) { Task { await model.move(id: moving.id, status: status); self.moving = nil } } } }
            }
            .onChange(of: store.taskChangeRevision) { if active { if let row = store.lastTaskChange { model.apply(row) } else { Task { await model.load() } } } }
            .onChange(of: scenePhase) { _, phase in if active && phase == .active { Task { await model.load() } } }
            .task(id: active && scenePhase == .active) { guard active && scenePhase == .active else { return }; await model.load(); while !Task.isCancelled { do { try await Task.sleep(for: store.refreshDelay); if scenePhase == .active { await model.load() } } catch { return } } }.refreshable { await model.load() }
    }
}
