import SwiftUI

struct SongNoteRow: View {
    let file: APIRecord
    let open: () -> Void
    var body: some View {
        Button(action: open) {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text(file.title).font(.body.weight(.medium))
                    Text(file["groupName"].text + (file["removalPending"].flag ? " · Removal pending" : ""))
                        .font(.footnote).foregroundStyle(Color.statiSecondary)
                }.frame(maxWidth: .infinity, alignment: .leading)
            } icon: { Image(systemName: file["contentType"].text == "application/pdf" ? "doc.richtext" : "photo") }
            .frame(minHeight: 44)
        }.disabled(file["removalPending"].flag)
    }
}
