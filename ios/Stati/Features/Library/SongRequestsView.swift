import SwiftUI

struct SongRequestsView: View {
    @Environment(AppStore.self) private var store
    var body: some View {
        List {
            if store.songCommands.needsRecovery {
                Section {
                    Text("Your saved song requests could not be opened. The existing file has been kept.").foregroundStyle(Color.statiSecondary)
                    Button("Retry reading song requests") { store.songCommands.retryReading() }.frame(minHeight: 44)
                }
            } else if store.songCommands.requests.isEmpty {
                ContentUnavailableView("No song requests", systemImage: "clock.arrow.circlepath", description: Text("Copy and delete requests stay here until the computer finishes and you dismiss the result."))
            } else {
                ForEach(store.songCommands.requests) { command in
                    Section { SongRequestRow(command: command) }
                }
            }
        }.navigationTitle("Song requests").navigationBarTitleDisplayMode(.inline)
    }
}
