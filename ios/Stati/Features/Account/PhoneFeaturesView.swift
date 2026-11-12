import SwiftUI

struct PhoneFeaturesView: View {
    @AppStorage("stati.liveSong.enabled") private var liveSong = false

    var body: some View {
        Form {
            SiriFeaturesSection()
            Section("Service") {
                Toggle(isOn: $liveSong) { Label("Live song on Lock Screen", systemImage: "waveform") }
            }
        }
        .navigationTitle("Features")
        .navigationBarTitleDisplayMode(.inline)
    }
}
