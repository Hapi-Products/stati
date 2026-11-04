import SwiftUI

struct TaskCommentRow: View {
    @Environment(AppStore.self) private var store
    let note: APIRecord
    let remove: () -> Void
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            MemberAvatar(api: store.api, path: note["authorPhotoUrl"].text, initials: String(note["authorName"].text.prefix(1)), size: 28).dynamicTypeSize(.large)
            VStack(alignment: .leading, spacing: 3) {
                Text(note["authorName"].text).font(.footnote.weight(.medium)).foregroundStyle(Color.statiSecondary)
                Text(note["body"].text).textSelection(.enabled)
            }.frame(maxWidth: .infinity, alignment: .leading)
        }.padding(.vertical, 2)
            .contextMenu { if note["canDelete"].flag { Button("Delete comment", systemImage: "trash", role: .destructive, action: remove) } }
    }
}
