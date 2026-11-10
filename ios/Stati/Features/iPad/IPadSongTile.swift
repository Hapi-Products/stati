import SwiftUI

struct IPadSongTile: View {
    let song: APIRecord
    var large = false

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            preview
            Text(song.title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            if !song["groupName"].text.isEmpty {
                Text(song["groupName"].text)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(.systemBackground), in: .rect(cornerRadius: 14))
        .overlay {
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(.quaternary)
        }
        .contentShape(.rect)
        .accessibilityHidden(true)
    }

    private var preview: some View {
        VStack(alignment: .leading, spacing: 7) {
            Image(systemName: "music.note")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tint)
            Divider()
            Text(song["firstSlide"].text)
                .font(large ? .callout : .footnote)
                .lineSpacing(2)
                .lineLimit(4)
                .foregroundStyle(.secondary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: large ? 144 : 112, maxHeight: large ? 144 : 112, alignment: .topLeading)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 8))
    }
}
