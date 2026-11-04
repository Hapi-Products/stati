import SwiftUI

struct SongRequestRow: View {
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    let command: SongCommand
    private var computerName: String { store.computers.first { $0.id == command.computerID }?["name"].text ?? "Church computer" }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(command.songTitle?.isEmpty == false ? command.songTitle ?? "Song request" : "Song request").font(.title3.bold())
            Text(computerName).font(.footnote).foregroundStyle(Color.statiSecondary)
            SongCommandStatusView(command: command)
            NoticeView(text: store.songCommands.errors[command.key] ?? "")
        }.padding(.vertical, 4)
        .task(id: command.id) {
            while !Task.isCancelled {
                if scenePhase == .active { await store.songCommands.check(command.id) }
                guard let current = store.songCommands.requests.first(where: { $0.id == command.id }), !current.isTerminal else { return }
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
            }
        }
    }
}
