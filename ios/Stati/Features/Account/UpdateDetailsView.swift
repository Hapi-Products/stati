import SwiftUI

struct UpdateDetailsView: View {
    @Environment(\.dismiss) private var dismiss
    let update: AppUpdate
    var body: some View {
        List {
            Section {
                Text(update.title).font(.headline)
                Text("Development build \(update.id)").font(.subheadline).foregroundStyle(Color.statiSecondary)
            }
            if !update.highlights.isEmpty {
                Section("Highlights") {
                    ForEach(update.highlights) { feature in
                        Label {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(feature.title).font(.headline)
                                Text(feature.detail).foregroundStyle(Color.statiSecondary)
                            }.fixedSize(horizontal: false, vertical: true)
                        } icon: { Image(systemName: feature.icon).foregroundStyle(.tint).accessibilityHidden(true) }
                            .padding(.vertical, 6)
                    }
                }
            }
            Section("More improvements") {
                ForEach(Array(update.details.enumerated()), id: \.offset) { index, text in
                    Label { Text(text).fixedSize(horizontal: false, vertical: true) }
                        icon: { Image(systemName: detailIcon(index)).foregroundStyle(.tint).accessibilityHidden(true) }
                        .padding(.vertical, 4)
                }
            }
        }.navigationTitle("Update details").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Close details", systemImage: "xmark") { dismiss() }.labelStyle(ActionIconLabelStyle()) } }
    }
    private func detailIcon(_ index: Int) -> String {
        let currentIcons = ["app", "arrow.down.doc", "sidebar.right", "sidebar.left", "iphone"]
        return update.id == AppUpdate.current.id && currentIcons.indices.contains(index) ? currentIcons[index] : "checkmark.circle"
    }
}
