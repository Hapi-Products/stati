import SwiftUI

struct ServiceSongRow: View {
    @Environment(AppStore.self) private var store
    let computerID: String
    let song: APIRecord
    @State private var preview = ""
    var body: some View {
        HStack(spacing: 10) { SlidePreview(text: preview); VStack(alignment: .leading, spacing: 4) { Text(song.title); if !song["arrangement"]["name"].text.isEmpty { Text(song["arrangement"]["name"].text).font(.footnote).foregroundStyle(Color.statiSecondary) } } }
            .task(id: song.id) { if let value = try? await store.api.request("/computers/" + computerID + "/songs/" + song["songId"].text), value["contentHash"] == song["contentHash"] { preview = value["firstSlide"].text } }
    }
}
