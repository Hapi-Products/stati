import SwiftUI

struct ReaderClickerHelp: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                Section("Connect") {
                    Text("Pair your presentation clicker in Settings → Bluetooth, or connect its USB receiver with a compatible adapter.")
                    Text("Return to the song viewer after pairing. Stați uses the clicker’s keyboard keys; pairing is handled by your device.")
                }
                Section("Change songs") {
                    Label("Next: Right, Down, Page Down or Space", systemImage: "chevron.right")
                    Label("Previous: Left, Up, Page Up or Backspace", systemImage: "chevron.left")
                    Text("Controls stop at the first and last item. A clicker that sends different keys may need its presentation mode changed.").font(.footnote).foregroundStyle(Color.statiSecondary)
                }
            }.navigationTitle("Presentation clicker").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
