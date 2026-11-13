import SwiftUI

struct PhoneFeaturesView: View {
    @Environment(AppStore.self) private var store
    @AppStorage("stati.liveSong.enabled") private var liveSong = false

    var body: some View {
        Form {
            if store.isAdmin { BuildPauseControl() }
            SiriFeaturesSection()
            Section("Service") {
                Toggle(isOn: $liveSong) { Label("Live song on Lock Screen", systemImage: "waveform") }
            }
        }
        .navigationTitle("Features")
        .navigationBarTitleDisplayMode(.inline)
    }
}
