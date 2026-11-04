import SwiftUI

struct NewTaskView: View {
    @Environment(AppStore.self) private var store
    let done: () -> Void
    @State private var title = ""
    @State private var details = ""
    @State private var urgent = false
    @State private var busy = false
    @State private var message = ""
    @State private var taskID = UUID().uuidString.lowercased()
    var body: some View {
        NavigationStack { Form { TextField("Title", text: $title); TextField("Details", text: $details, axis: .vertical).lineLimit(3...6); Toggle("Urgent", systemImage: "flag", isOn: $urgent); NoticeView(text: message) }
            .navigationTitle("New task").toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark", action: done).labelStyle(ActionIconLabelStyle()) }
                ToolbarItem(placement: .confirmationAction) { Button("Create task", systemImage: "checkmark") { Task { await create() } }.labelStyle(.iconOnly).buttonStyle(.borderedProminent).buttonBorderShape(.circle).disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy) }
            }
        }
    }
    private func create() async {
        let epoch = store.accountEpoch, owner = store.me?.id
        busy = true; defer { busy = false }
        do { let result = try await store.api.request("/tasks", method: "POST", body: .object(["action": .string("create"), "id": .string(taskID), "title": .string(title), "body": .string(details), "urgent": .bool(urgent)]))
            guard epoch == store.accountEpoch, owner != nil, owner == store.me?.id, result["task"]["id"].text == taskID else { return }
            store.taskChanged(APIRecord(raw: result["task"].fields)); done()
        }
        catch {
            guard epoch == store.accountEpoch, owner != nil, owner == store.me?.id else { return }
            if let current = try? await store.api.request("/tasks/" + taskID), epoch == store.accountEpoch, current["task"]["id"].text == taskID {
                store.taskChanged(APIRecord(raw: current["task"].fields)); done()
            } else { message = error.localizedDescription }
        }
    }
}
