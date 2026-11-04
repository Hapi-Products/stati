import SwiftUI

struct IPadTasksView: View {
    @Environment(\.scenePhase) private var scenePhase
    let store: AppStore
    let active: Bool
    @State private var model: IPadTasksModel
    @State private var query = ""
    @State private var selected: APIRecord?
    @State private var inspectorOpen = false
    @State private var creating = false
    @State private var inspectorWidth: CGFloat = 400
    private let statuses = [("new", "New"), ("in-progress", "In progress"), ("complete", "Complete")]
    init(store: AppStore, active: Bool = true) {
        self.store = store; self.active = active; _model = State(initialValue: IPadTasksModel(store: store))
        #if DEBUG && targetEnvironment(simulator)
        if NativeReview.route == "ipad-tasks-expanded-landscape" { _inspectorWidth = State(initialValue: 600) }
        if ["ipad-tasks", "ipad-tasks-inspector-landscape", "ipad-tasks-expanded-landscape"].contains(NativeReview.route ?? "") { _selected = State(initialValue: APIRecord(raw: NativeReview.task.fields)); _inspectorOpen = State(initialValue: true) }
        #endif
    }
    var body: some View {
        GeometryReader { geometry in
            if geometry.size.width >= 650 {
                HStack(spacing: 0) {
                    board.frame(maxWidth: .infinity)
                    if inspectorOpen, let selected {
                        Divider()
                        taskDetail(selected)
                            .id(selected.id).frame(width: min(inspectorWidth, maximumWidth(in: geometry.size.width)))
                            .overlay(alignment: .leading) { InspectorResizeHandle(width: inspectorBinding(in: geometry.size.width), maximumWidth: maximumWidth(in: geometry.size.width)).offset(x: -22) }
                    }
                }
            } else {
                board.sheet(isPresented: $inspectorOpen) {
                    if let selected { NavigationStack { taskDetail(selected) } }
                }
            }
        }.background(Color(.systemBackground))
            .navigationTitle("Tasks").navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .toolbar, prompt: "Search tasks").searchToolbarBehavior(.minimize)
            .toolbar { if !inspectorOpen { Button("New task", systemImage: "plus") { creating = true }.labelStyle(ActionIconLabelStyle()) } }
            .sheet(isPresented: $creating) { NewTaskView { creating = false }.presentationSizing(.form) }
            .onChange(of: inspectorOpen) { _, open in if !open { selected = nil } }
            .onChange(of: store.taskChangeRevision) { if active { if let row = store.lastTaskChange { model.apply(row) } else { Task { await model.load() } } } }
            .onChange(of: scenePhase) { _, phase in if active && phase == .active { Task { await model.load() } } }
            .task(id: active && scenePhase == .active) {
                guard active && scenePhase == .active else { return }
                await model.load()
                while !Task.isCancelled {
                    do { try await Task.sleep(for: store.refreshDelay); if scenePhase == .active { await model.load() } } catch { return }
                }
            }.refreshable { await model.load() }
    }
    private func maximumWidth(in available: CGFloat) -> CGFloat { min(640, max(320, available - 301)) }
    private func inspectorBinding(in available: CGFloat) -> Binding<CGFloat> {
        let maximum = maximumWidth(in: available)
        return Binding(get: { min(maximum, max(320, inspectorWidth)) }, set: { inspectorWidth = min(maximum, max(320, $0)) })
    }
    private var board: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                if model.removed != nil { Button("Undo task removal", systemImage: "arrow.uturn.backward") { Task { await model.undo() } } }
                NoticeView(text: model.message)
                ForEach(statuses, id: \.0) { status, title in
                    IPadTaskBand(model: model, status: status, title: title, query: query, selectedID: selected?.id) { selected = $0; inspectorOpen = true }
                }
                if model.loading && model.tasks.isEmpty { ProgressView("Loading tasks…") }
                if model.tasks.count < model.total { Button("Load more tasks") { Task { await model.load(more: true) } }.disabled(model.loading) }
            }.padding(24)
        }.background(Color(.systemBackground))
    }
    private func taskDetail(_ task: APIRecord) -> some View {
        TaskDetailView(taskID: task.id, close: closeInspector, unavailable: closeInspector) { removed in model.removed = removed; closeInspector() }
    }
    private func closeInspector() { inspectorOpen = false; selected = nil }
}
