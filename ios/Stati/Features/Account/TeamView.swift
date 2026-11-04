import SwiftUI

struct TeamView: View {
    @Environment(AppStore.self) private var store
    @State private var members: [APIRecord] = []
    @State private var message = ""
    @State private var busy = false
    @State private var loading = true
    @State private var removing: APIRecord?
    @State private var confirmingRemoval = false
    private let roleOrder = ["Administrator", "Pastor", "Worship leader", "Choir director", "Worship member", "Member"]
    var body: some View {
        List {
            if !message.isEmpty { NoticeView(text: message) }
            if loading && members.isEmpty { ProgressView("Loading team…") }
            if !loading && members.isEmpty && message.isEmpty { Text("No team members to show.").foregroundStyle(Color.statiSecondary) }
            ForEach(roleOrder, id: \.self) { role in
                let people = members.filter { $0.roleLabel == role }
                if !people.isEmpty {
                    LabeledSection(LocalizedStringKey(role)) {
                        ForEach(people) { member in
                            TeamMemberRow(member: member, manageable: canManage(member), busy: busy) { action, role in
                                Task { await change(member, action: action, role: role) }
                            } remove: { removing = member; confirmingRemoval = true }
                        }
                    }
                }
            }
        }.navigationTitle("Team").navigationBarTitleDisplayMode(.large)
            .task(id: store.me?.id) { _ = await load() }.refreshable { _ = await load() }
            .confirmationDialog("Remove \(removing?.personName ?? "member")?", isPresented: $confirmingRemoval, titleVisibility: .visible) {
                if let removing { Button("Remove member", role: .destructive) { Task { await change(removing, action: "remove"); self.removing = nil } } }
            }
    }
    private func canManage(_ member: APIRecord) -> Bool { member.id != store.me?.id && (store.isAdmin || store.me?["ministryRole"].text == "worship_leader" && member["role"].text == "member" && ["", "worship_member", "worship_leader"].contains(member["ministryRole"].text)) }
    private func load() async -> Bool {
        message = ""
        loading = true; defer { loading = false }
        let owner = store.me?.id
        do {
            let result = try await store.api.request("/members").records
            try Task.checkCancellation()
            guard store.me?.id == owner else { return false }
            members = result
            return true
        } catch is CancellationError { return false }
        catch { message = error.localizedDescription; return false }
    }
    private func change(_ member: APIRecord, action: String, role: JSONValue? = nil) async {
        guard !busy, canManage(member) else { return }
        busy = true; defer { busy = false }; var body: [String: JSONValue] = ["action": .string(action)]
        if let role { body["ministryRole"] = role }
        if action == "approve" && !store.isAdmin { body["ministryRole"] = .string(member["ministryRole"].text.isEmpty ? "worship_member" : member["ministryRole"].text) }
        do { _ = try await store.api.request("/members/" + member.id, method: "PATCH", body: .object(body)); if await load() { message = "Member updated." } else { message = "Member updated. Pull down to reload the team. " + message } }
        catch is CancellationError { }
        catch { message = error.localizedDescription }
    }
}
