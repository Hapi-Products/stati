import SwiftUI

struct SongCommandStatusView: View {
    @Environment(AppStore.self) private var store
    let command: SongCommand
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(command.title, systemImage: command.isTerminal ? (command.status == .applied ? "checkmark.circle" : "exclamationmark.circle") : "clock").font(.headline)
            Text(command.statusText).foregroundStyle(Color.statiSecondary)
            if command.isTerminal {
                Button("Dismiss result") { store.songCommands.dismiss(command.id) }.frame(minHeight: 44)
            } else {
                Button(command.status == .unconfirmed ? "Retry same request" : "Check status") {
                    Task { await store.songCommands.check(command.id, resendIfAbsent: command.status == .unconfirmed) }
                }.frame(minHeight: 44).disabled(store.songCommands.busy.contains(command.key))
            }
        }.frame(maxWidth: .infinity, alignment: .leading).accessibilityElement(children: .contain)
    }
}
