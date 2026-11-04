import SwiftUI

struct IPadTaskBand: View {
    @Environment(AppStore.self) private var store
    @Bindable var model: IPadTasksModel
    let status: String
    let title: String
    let query: String
    let selectedID: String?
    let open: (APIRecord) -> Void
    @State private var targeted = false
    private var tasks: [APIRecord] { model.tasks.filter { $0["status"].text == status && (query.isEmpty || $0.title.localizedStandardContains(query) || $0["body"].text.localizedStandardContains(query)) } }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) { Text(title).font(.headline); Text("\(tasks.count)").font(.subheadline).foregroundStyle(Color.statiSecondary).monospacedDigit(); Spacer() }.padding(.horizontal, 16).padding(.vertical, 10)
            if tasks.isEmpty { Text(query.isEmpty ? "No tasks here." : "No matching tasks.").foregroundStyle(Color.statiSecondary).padding(16) }
            ForEach(tasks) { task in
                Button { open(task) } label: {
                    HStack(alignment: .top, spacing: 12) {
                        MemberAvatar(api: store.api, path: task["authorPhotoUrl"].text, initials: String(task["authorName"].text.prefix(1)), size: 32).accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 5) {
                            HStack { Text(task.title).font(.headline).foregroundStyle(.primary); if task["urgent"].flag { Image(systemName: "flag.fill").foregroundStyle(.red) } }
                            if !task["body"].text.isEmpty { Text(task["body"].text).font(.subheadline).foregroundStyle(Color.statiSecondary).lineLimit(2) }
                            if task["noteCount"].number > 0 { Label("\(Int(task["noteCount"].number))", systemImage: "bubble.right").font(.footnote).foregroundStyle(Color.statiSecondary) }
                        }
                        Spacer(minLength: 0)
                        Image(systemName: status == "complete" ? "checkmark.circle.fill" : "circle").foregroundStyle(status == "complete" ? AppIconAppearance.shared.accent : Color.statiSecondary).font(.title3)
                        Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Color.statiSecondary)
                    }.padding(16).frame(maxWidth: .infinity, alignment: .leading).background(selectedID == task.id ? AppIconAppearance.shared.accent.opacity(0.08) : Color(.systemBackground), in: .rect(cornerRadius: 10)).contentShape(.rect)
                }.buttonStyle(.plain).disabled(model.working.contains(task.id)).draggable(task.id)
                    .contextMenu {
                        if task["canManage"].flag { ForEach([("new", "New"), ("in-progress", "In progress"), ("complete", "Complete")].filter { $0.0 != status }, id: \.0) { next, label in Button("Move to " + label, systemImage: "folder") { Task { await model.move(id: task.id, status: next) } } } }
                        if task["canDelete"].flag { Button("Delete task", systemImage: "trash", role: .destructive) { Task { await model.delete(task) } } }
                    }
                if task.id != tasks.last?.id { Divider().padding(.leading, 56) }
            }
        }.padding(4).frame(maxWidth: .infinity, alignment: .leading).background(targeted ? AppIconAppearance.shared.accent.opacity(0.15) : Color(.systemBackground), in: .rect(cornerRadius: 12))
            .dropDestination(for: String.self) { ids, _ in
                guard let id = ids.first, model.tasks.contains(where: { $0.id == id && $0["canManage"].flag }), !model.working.contains(id) else { return false }
                Task { await model.move(id: id, status: status) }; return true
            } isTargeted: { targeted = $0 }
    }
}
