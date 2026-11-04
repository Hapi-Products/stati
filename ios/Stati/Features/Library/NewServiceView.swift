import SwiftUI

struct NewServiceView: View {
    @Environment(AppStore.self) private var store
    let computerID: String
    let done: () -> Void
    @State private var title = ""
    @State private var schedule = Date()
    @State private var message = ""
    @State private var busy = false
    @State private var uncertain = false
    var body: some View {
        NavigationStack {
            Form { TextField("Service name", text: $title); DatePicker("Date", selection: $schedule, displayedComponents: .date); DatePicker("Time", selection: $schedule, displayedComponents: .hourAndMinute); NoticeView(text: message) }
                .navigationTitle("New service").toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: done) }
                    ToolbarItem(placement: .confirmationAction) { Button("Create") { Task { let epoch = store.accountEpoch, owner = store.me?.id; busy = true; defer { busy = false }; do { let result = try await store.api.request("/computers/" + computerID + "/services", method: "POST", body: .object(["type": .string("create"), "title": .string(title), "date": .string(ServiceSchedule.date(schedule)), "time": .string(ServiceSchedule.time(schedule))]))
                        guard epoch == store.accountEpoch, owner != nil, owner == store.me?.id, computerID == store.selectedComputer else { return }
                        let created = result["plans"].records.first { $0.id == result["activeServiceId"].text }
                        store.servicesChanged(computerID: computerID, createdID: created?.id); done() } catch { uncertain = true; message = "Creation was not confirmed. Close this screen and refresh services before creating another service. " + error.localizedDescription } } }.disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy || uncertain) }
                }
        }
    }
}
