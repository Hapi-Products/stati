import SwiftUI

struct IPadServiceReadyCheck: View {
    @Environment(AppStore.self) private var store
    @Environment(\.worshipLiveContext) private var live
    let plan: APIRecord
    let computerID: String

    @State private var saved: [String: String]?
    @State private var checked = false
    @State private var preparing = false
    @State private var progress = 0
    @State private var savedOrder = false
    @State private var preparedPlan: APIRecord?
    @State private var message = ""
    @State private var testing = false

    private var songs: [APIRecord] { plan["songs"].records }
    private var missing: [APIRecord] {
        songs.filter {
            let hash = $0["contentHash"].text
            return hash.isEmpty || saved?[$0["songId"].text] != hash
        }
    }
    private var scope: String {
        store.accountEpoch.uuidString + computerID + plan.id + String(plan["revision"].number)
    }

    private var changes: [ServiceSetChange] {
        guard let preparedPlan else { return [] }
        return ServiceSetChange.compare(previous: preparedPlan["songs"].records, current: songs)
    }

    var body: some View {
        Section("Ready check") {
            if !checked {
                ProgressView("Checking saved songs…")
            } else if saved == nil {
                Label("Saved songs could not be checked", systemImage: "exclamationmark.circle")
            } else {
                Label("\(songs.count - missing.count) of \(songs.count) songs saved on this iPad",
                      systemImage: missing.isEmpty && !songs.isEmpty ? "checkmark.circle" : "arrow.down.circle")
            }
            if !changes.isEmpty {
                DisclosureGroup("Changes since preparation (\(changes.count))") {
                    ForEach(changes) { change in
                        Label(change.title, systemImage: change.added ? "plus" : "minus")
                            .foregroundStyle(change.added ? Color.green : Color.red)
                            .accessibilityLabel((change.added ? "Added " : "Removed ") + change.title)
                    }
                }
            }
            if savedOrder && missing.isEmpty {
                Label("Running order saved", systemImage: "checkmark.circle")
            }
            if !missing.isEmpty, saved != nil {
                DisclosureGroup("Songs to save (\(missing.count))") {
                    ForEach(missing) { song in Text(song.title) }
                }
            }
            if plan["active"].flag {
                let connected = live?.reader.clickerServiceID == plan.id
                let status = if live?.reader.clickerStatusAvailable == true {
                    connected ? "Phone clicker connected" : "Phone clicker not connected"
                } else if live?.reader.status == .waiting {
                    "Phone clicker not connected"
                } else {
                    "Phone clicker status unavailable"
                }
                Label(status, systemImage: connected ? "cursorarrow.click.2" : "cursorarrow.click")
            }
            if store.canPlan || store.me?["ministryRole"].text == "pastor" {
                Button("Clicker Test", systemImage: "stopwatch") { testing = true }
            }
            if preparing {
                ProgressView("Preparing songs (\(progress))")
            } else if checked && !songs.isEmpty && (!savedOrder || !missing.isEmpty) {
                Button(preparedPlan == nil ? "Prepare set for offline use" : "Update saved set", systemImage: "arrow.down.to.line") { preparing = true }
            }
            if !message.isEmpty { Text(message).foregroundStyle(.secondary) }
        }
        .sheet(isPresented: $testing) { ClickerRehearsalView(receives: true) }
        .task(id: scope) { checkSavedSongs() }
        .task(id: preparing ? scope : "") {
            if preparing { await prepare() }
        }
    }

    private func checkSavedSongs() {
        checked = true
        preparedPlan = try? store.offlineSongs.services(computer: computerID).first { $0.id == plan.id }
        savedOrder = preparedPlan?["revision"] == plan["revision"] && preparedPlan?["songs"] == plan["songs"]
        saved = (try? store.offlineSongs.rows(computer: computerID)).map { rows in
            Dictionary(rows.filter { $0.raw["text"] != nil }.map { ($0.id, $0["contentHash"].text) },
                       uniquingKeysWith: { _, latest in latest })
        }
    }

    private func prepare() async {
        defer { preparing = false }
        guard store.canReadSongs, store.selectedComputer == computerID else { return }
        progress = 0
        message = ""
        let account = store.accountEpoch
        let service = plan
        var downloaded: [APIRecord] = []
        var requested: Set<String> = []
        let isCurrent = { account == store.accountEpoch && computerID == store.selectedComputer && store.canReadSongs }
        do {
            for item in missing {
                let id = item["songId"].text
                let hash = item["contentHash"].text
                guard isCurrent(), !Task.isCancelled else { return }
                guard id.utf8.count == 64, id.allSatisfy(\.isHexDigit), hash.utf8.count == 64,
                      requested.insert(id + hash).inserted else { continue }
                do {
                    let song = APIRecord(raw: try await store.api.request("/computers/" + computerID + "/songs/" + id).fields)
                    guard isCurrent() else { return }
                    if song.id == id, song["contentHash"].text == hash, song.raw["text"] != nil {
                        downloaded.append(song)
                    }
                } catch let error as APIError where error.status == 404 {
                    continue
                }
                progress += 1
                if downloaded.count == 20 {
                    try await store.offlineSongs.save(downloaded, computer: computerID, renderPDFs: false)
                    downloaded.removeAll(keepingCapacity: true)
                }
            }
            guard isCurrent(), !Task.isCancelled else { return }
            if !downloaded.isEmpty { try await store.offlineSongs.save(downloaded, computer: computerID, renderPDFs: false) }
            guard isCurrent(), !Task.isCancelled else { return }
            checkSavedSongs()
            if missing.isEmpty {
                try store.offlineSongs.saveService(service, computer: computerID)
                preparedPlan = service
                savedOrder = true
                message = "This running order and its songs are ready offline."
            } else {
                message = "Some songs could not be saved. Check the versions listed above."
            }
        } catch is CancellationError {
            return
        } catch {
            guard isCurrent() else { return }
            if let failure = error as? APIError, [401, 403].contains(failure.status) {
                store.offlineSongs.invalidate(computer: computerID)
            }
            checkSavedSongs()
            message = error.localizedDescription
        }
    }
}
