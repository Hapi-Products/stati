import SwiftUI

struct AppIconPickerButton: View {
    @State private var presented = false
    var profileRow = false
    var body: some View {
        Button { presented = true } label: {
            if profileRow { ProfileDestinationRow(title: "App icon", icon: "app") }
            else { Label("App icon", systemImage: "app") }
        }
            .sheet(isPresented: $presented) { AppIconPickerSheet() }
    }
}
