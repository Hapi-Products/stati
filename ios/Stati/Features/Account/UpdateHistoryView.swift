import SwiftUI

struct UpdateHistoryView: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        List {
            ForEach(AppUpdate.previous) { update in
                DisclosureGroup {
                    ForEach(update.details, id: \.self) { Text($0).padding(.vertical, 4) }
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(update.title).font(.headline)
                        Text("Build \(update.id)").font(.subheadline).foregroundStyle(Color.statiSecondary)
                    }.padding(.vertical, 4)
                }
            }
        }.navigationTitle("Previous updates").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Close previous updates", systemImage: "xmark") { dismiss() }.labelStyle(ActionIconLabelStyle()) } }
    }
}
