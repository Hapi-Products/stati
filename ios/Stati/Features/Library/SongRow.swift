import SwiftUI

struct SongRow: View {
    let song: APIRecord
    var body: some View {
        HStack(spacing: 12) {
            SlidePreview(text: song["firstSlide"].text)
            VStack(alignment: .leading, spacing: 4) { Text(song.title).font(.body.weight(.medium)); if !song["groupName"].text.isEmpty { Text(song["groupName"].text).font(.footnote).foregroundStyle(Color.statiSecondary) } }
        }.padding(.vertical, 3)
    }
}
