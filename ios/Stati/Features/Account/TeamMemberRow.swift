import SwiftUI

struct TeamMemberRow: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dynamicTypeSize) private var typeSize
    let member: APIRecord
    let manageable: Bool
    let busy: Bool
    let change: (String, JSONValue?) -> Void
    let remove: () -> Void
    var body: some View {
        Group {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 8) { identity; if manageable { HStack { Spacer(); actions } } }
            } else { HStack(spacing: 10) { identity; Spacer(minLength: 0); if manageable { actions } } }
        }.disabled(busy).padding(.vertical, 4)
    }
    private var identity: some View {
        HStack(spacing: 10) {
            MemberAvatar(api: store.api, path: member["photoUrl"].text, initials: String(member.personName.prefix(1)))
            VStack(alignment: .leading, spacing: 3) {
                Text(member.personName).font(.body.weight(.medium))
                if member["status"].text == "pending" { Text("Awaiting approval").font(.footnote).foregroundStyle(Color.statiSecondary) }
            }
        }
    }
    private var actions: some View {
        HStack(spacing: 8) {
            if member["status"].text == "pending" {
                Button("Approve \(member.personName)", systemImage: "checkmark") { change("approve", nil) }.labelStyle(ActionIconLabelStyle()).frame(minWidth: 44, minHeight: 44)
            }
            Menu("Change role for \(member.personName)", systemImage: "person.badge.key") {
                if store.isAdmin { Button("Member") { change("assign-role", .null) } }
                ForEach(["worship_leader", "worship_member"] + (store.isAdmin ? ["choir_director", "pastor", "commenter"] : []), id: \.self) { role in
                    Button(role.replacingOccurrences(of: "_", with: " ").capitalized) { change("assign-role", .string(role)) }
                }
                if store.isAdmin {
                    Divider()
                    Button(member["role"].text == "admin" ? "Make member" : "Make administrator") { change(member["role"].text == "admin" ? "demote" : "promote", nil) }
                }
            }.labelStyle(ActionIconLabelStyle()).frame(minWidth: 44, minHeight: 44)
            if store.isAdmin {
                Button("Remove \(member.personName)", systemImage: "trash", role: .destructive, action: remove).labelStyle(ActionIconLabelStyle(destructive: true)).frame(minWidth: 44, minHeight: 44)
            }
        }.buttonStyle(.borderless)
    }
}
