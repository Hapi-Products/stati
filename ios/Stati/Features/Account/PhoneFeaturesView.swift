import SwiftUI

struct PhoneFeaturesView: View {
    @AppStorage("stati.liveSong.enabled") private var liveSong = false

    var body: some View {
        Form {
            SiriFeaturesSection()
            Section("Service") {
                Toggle("Live song on Lock Screen", isOn: $liveSong)
            }
        }
        .navigationTitle("Features")
        .navigationBarTitleDisplayMode(.inline)
    }
}
