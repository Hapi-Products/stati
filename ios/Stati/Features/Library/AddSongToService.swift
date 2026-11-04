import SwiftUI

struct AddSongToService: View {
    @Environment(AppStore.self) private var store
    let computerID: String
    let song: APIRecord
    let done: () -> Void
    @State private var services: [APIRecord] = []
    @State private var message = ""
    @State private var busy = false
    @State private var appearanceID = UUID().uuidString.lowercased()
    var body: some View {
        NavigationStack {
            List { Section { ForEach(services.filter { !$0["archived"].flag }) { plan in Button(plan.title) { Task { await add(plan.id) } }.disabled(busy || !plan["leadership"]["canEdit"].flag) } }; NoticeView(text: message) }
                .navigationTitle("Add to service").toolbar { Button("Close", action: done) }
                .task { do { services = try await store.api.request("/computers/" + computerID + "/services")["plans"].records } catch { message = error.localizedDescription } }
        }
    }
    private func add(_ id: String) async {
        busy = true; defer { busy = false }
        do {
            let path = "/computers/" + computerID + "/services"
            guard var plan = try await store.api.request(path)["plans"].records.first(where: { $0.id == id }), plan["leadership"]["canEdit"].flag else { throw APIError(status: 409, message: "Open this service and take over its leadership before changing it.") }
            if !plan["songs"].items.contains(where: { $0["id"].text == appearanceID }) {
                plan["songs"] = .array(plan["songs"].items + [.object(["id": .string(appearanceID), "songId": .string(song.id), "title": .string(song.title), "filename": song["filename"], "contentHash": song["contentHash"], "reviewed": .bool(false)])])
                _ = try await store.api.request(path, method: "POST", body: .object(["type": .string("save"), "id": .string(id), "plan": plan.value]))
            }
            done()
        } catch { message = error.localizedDescription }
    }
}
