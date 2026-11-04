import SwiftUI

struct IPadTaskCard: View {
    @Environment(AppStore.self) private var store
    let task: APIRecord
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) { if task["urgent"].flag { Image(systemName: "flag.fill").foregroundStyle(.red) }; Text(task.title).font(.headline).foregroundStyle(.primary) }
            if !task["body"].text.isEmpty { Text(task["body"].text).font(.subheadline).foregroundStyle(Color.statiSecondary).lineLimit(3).multilineTextAlignment(.leading) }
            HStack(spacing: 8) { MemberAvatar(api: store.api, path: task["authorPhotoUrl"].text, initials: String(task["authorName"].text.prefix(1)), size: 28); Text(task["authorName"].text).font(.footnote).foregroundStyle(Color.statiSecondary); Spacer(); if task["noteCount"].number > 0 { Label("\(Int(task["noteCount"].number))", systemImage: "bubble.right").font(.footnote).foregroundStyle(Color.statiSecondary) } }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(18).background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 12)).contentShape(.rect)
    }
}
