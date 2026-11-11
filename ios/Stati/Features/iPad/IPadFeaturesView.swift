import SwiftUI
import AppIntents

struct IPadFeaturesView: View {
    var body: some View {
        Form {
            Section {
                Link(destination: URL(string: UIApplication.openSettingsURLString)!) {
                    Label("Open Settings", systemImage: "gearshape")
                }
                ShortcutsLink()
                AppIconPickerButton()
            }
            Section { NavigationLink("What’s New") { WhatsNewView() } }
        }
        .navigationTitle("Features")
        .navigationBarTitleDisplayMode(.inline)
    }
}
