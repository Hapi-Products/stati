import SwiftUI

struct IPadAccessUnavailableView: View {
    let store: AppStore
    @State private var checking = false
    var body: some View {
        ContentUnavailableView {
            Label("iPad access unavailable", systemImage: "ipad.slash")
        } description: {
            Text("Your role cannot use Stați on iPad right now.")
        } actions: {
            Button("Check access", systemImage: "arrow.clockwise") {
                Task { checking = true; await store.refresh(); checking = false }
            }.disabled(checking).buttonStyle(.borderedProminent)
            Button("Sign out", role: .destructive) { Task { await store.signOut() } }.buttonStyle(.bordered)
        }.frame(maxWidth: .infinity, maxHeight: .infinity).background(.background)
    }
}
