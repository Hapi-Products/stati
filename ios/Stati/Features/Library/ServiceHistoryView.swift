import SwiftUI

struct ServiceHistoryView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppStore.self) private var store
    let computerID: String
    let serviceID: String
    @State private var versions: [APIRecord] = []
    @State private var message = ""
    var body: some View {
        List { ForEach(versions) { version in VStack(alignment: .leading, spacing: 5) { Text("Revision \(Int(version["serviceRevision"].number))").font(.headline); Text(version["approvedByLabel"].text).foregroundStyle(Color.statiSecondary) } }; NoticeView(text: message) }
            .navigationTitle("Version history").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close history", systemImage: "xmark") { dismiss() }.labelStyle(ActionIconLabelStyle()) } }
            .task { do { versions = try await store.api.request("/computers/" + computerID + "/services/" + serviceID + "/versions")["versions"].records; if versions.isEmpty { message = "No saved versions yet." } } catch { message = error.localizedDescription } }
    }
}
