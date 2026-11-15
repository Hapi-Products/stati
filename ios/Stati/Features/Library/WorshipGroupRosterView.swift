import SwiftUI

struct WorshipGroupRosterView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let groups: WorshipGroupsModel
    let groupID: String
    let title: String
    @State private var detail = JSONValue.null
    @State private var message = ""

    private var roster: [APIRecord] { detail["members"].records }
    private var leaderID: String { detail["ownerId"].text }

    var body: some View {
        NavigationStack {
            List {
                if !message.isEmpty {
                    NoticeView(text: message)
                    Button("Try again", systemImage: "arrow.clockwise") { Task { await load() } }
                } else if detail == .null {
                    ProgressView("Loading group members…")
                } else {
                    peopleSection("Leaders", people: roster.filter { $0.id == leaderID }, empty: "No leader listed")
                    peopleSection("Members", people: roster.filter { $0.id != leaderID }, empty: "No members listed")
                }
            }
            .navigationTitle(detail["name"].text.isEmpty ? title : detail["name"].text)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close members", systemImage: "xmark") { dismiss() }.labelStyle(.iconOnly)
                }
            }
            .task { await load() }
            .refreshable { await load() }
            .onChange(of: store.accountEpoch) { dismiss() }
            .onChange(of: groups.revision) {
                if !groups.groups.contains(where: { $0.id == groupID }) { dismiss() }
            }
        }
        .presentationSizing(.form)
    }

    private func peopleSection(_ name: String, people: [APIRecord], empty: String) -> some View {
        Section(name) {
            if people.isEmpty {
                Text(empty).foregroundStyle(.secondary)
            }
            ForEach(people) { person in
                HStack(spacing: 12) {
                    MemberAvatar(api: store.api, path: person["photoUrl"].text, initials: String(person.name.prefix(1)), size: 32)
                        .accessibilityHidden(true)
                    Text(person.name)
                }
            }
        }
    }

    private func load() async {
        message = ""
        do {
            let result = try await groups.detail(groupID)
            try Task.checkCancellation()
            detail = result
        } catch is CancellationError { }
        catch {
            detail = .null
            message = error.localizedDescription
        }
    }
}
