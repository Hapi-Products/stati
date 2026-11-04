import SwiftUI

struct TaskDetailView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    let taskID: String
    let close: (() -> Void)?
    let unavailable: (() -> Void)?
    let removed: (APIRecord) -> Void
    @State private var editor: TaskEditor?
    @State private var message = ""
    init(taskID: String, close: (() -> Void)? = nil, unavailable: (() -> Void)? = nil, removed: @escaping (APIRecord) -> Void) { self.taskID = taskID; self.close = close; self.unavailable = unavailable; self.removed = removed }
    var body: some View {
        Group {
            if let editor { TaskEditorContent(editor: editor, close: close, removed: removed) }
            else if !message.isEmpty { ContentUnavailableView("Task unavailable", systemImage: "exclamationmark.bubble", description: Text(message)) }
            else { ProgressView("Opening task…") }
        }.navigationTitle(close == nil ? "Task" : "Tasks").navigationBarTitleDisplayMode(.inline)
            .onChange(of: editor?.unavailable) { _, value in if value == true { closeUnavailable() } }
            .onChange(of: store.taskChangeRevision) { if scenePhase == .active { Task { await editor?.refresh() } } }
            .task(id: taskID + store.accountEpoch.uuidString + String(scenePhase == .active)) {
                guard scenePhase == .active else { return }
                await open()
                while !Task.isCancelled {
                    do { try await Task.sleep(for: store.refreshDelay); if scenePhase == .active { await editor?.refresh() } } catch { return }
                }
            }
    }
    private func open() async {
        guard editor == nil else { return }
        let owner = store.me?.id, epoch = store.accountEpoch
        do {
            let value = try await store.api.request("/tasks/" + taskID)
            try Task.checkCancellation(); guard owner != nil, store.me?.id == owner, store.accountEpoch == epoch, value["task"]["id"].text == taskID else { return }
            editor = TaskEditor(store: store, detail: value)
        } catch is CancellationError { }
        catch let error as APIError where error.status == 404 { closeUnavailable() }
        catch { if store.accountEpoch == epoch { message = error.localizedDescription } }
    }
    private func closeUnavailable() { if let unavailable { unavailable() } else { dismiss() } }
}
