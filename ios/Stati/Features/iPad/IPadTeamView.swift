import SwiftUI

struct IPadTeamView: View {
    @Environment(AppStore.self) private var store
    @State private var members: [APIRecord] = []
    @State private var loading = true
    @State private var message = ""
    var body: some View {
        List {
            if loading { ProgressView("Loading worship team…") }
            ForEach(["worship_leader", "worship_member"], id: \.self) { role in
                let people = members.filter { $0["ministryRole"].text == role && $0["status"].text == "active" }
                if !people.isEmpty {
                    LabeledSection(role == "worship_leader" ? "Worship leaders" : "Worship members") { ForEach(people) { member in HStack(spacing: 12) { MemberAvatar(api: store.api, path: member["photoUrl"].text, initials: String(member["first_name"].text.prefix(1))); Text(member.personName) } } }
                }
            }
            if !loading && members.isEmpty && message.isEmpty { Text("No worship team members to show.").foregroundStyle(Color.statiSecondary) }
            NoticeView(text: message)
        }.navigationTitle("Worship team").navigationBarTitleDisplayMode(.inline)
            .task(id: store.accountEpoch) {
                let epoch = store.accountEpoch, owner = store.me?.id
                loading = true; defer { loading = false }
                do { let people = try await store.api.request("/members").records; try Task.checkCancellation(); guard epoch == store.accountEpoch, owner != nil, owner == store.me?.id else { return }; members = people.filter { ["worship_leader", "worship_member"].contains($0["ministryRole"].text) }; message = "" }
                catch is CancellationError { }
                catch { if epoch == store.accountEpoch { message = error.localizedDescription } }
            }
    }
}
