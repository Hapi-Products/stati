import SwiftUI

struct WorshipReaderSongsView: View {
    @Environment(\.dismiss) private var dismiss
    let items: [SongGalleryItem]
    let selectedID: String
    let isService: Bool
    let select: (String) -> Void
    @State private var query = ""

    private var matching: [SongGalleryItem] {
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return search.isEmpty ? items : items.filter { $0.title.localizedStandardContains(search) }
    }

    var body: some View {
        NavigationStack {
            List(matching) { song in
                Button {
                    if song.id == selectedID { dismiss() }
                    else { select(song.id) }
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "music.note")
                            .foregroundStyle(.tint)
                            .accessibilityHidden(true)
                        Text(song.title)
                            .foregroundStyle(.primary)
                        Spacer()
                        if song.id == selectedID {
                            Image(systemName: "checkmark")
                                .foregroundStyle(.tint)
                                .accessibilityHidden(true)
                        }
                    }
                    .frame(minHeight: 44)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(song.id == selectedID ? .isSelected : [])
            }
            .listStyle(.insetGrouped)
            .overlay {
                if matching.isEmpty { ContentUnavailableView.search(text: query) }
            }
            .searchable(text: $query, prompt: "Find a song in this list")
            .navigationTitle(isService ? "Running order" : "Songs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}
