#if DEBUG && targetEnvironment(simulator)
import Foundation

@MainActor enum NativeLibraryPerformanceChecks {
    static func run(store _: AppStore) async {
        let store = AppStore()
        var checks: [String: Bool] = [:]
        let owner = UUID().uuidString.lowercased(), computer = UUID().uuidString.lowercased()
        var profile = NativeReview.person.fields; profile["id"] = .string(owner)
        store.me = APIRecord(raw: profile); store.selectedComputer = computer
        store.computers = [APIRecord(raw: ["id": .string(computer), "name": .string("Performance fixture")])]
        let root = URL.applicationSupportDirectory.appending(path: "SimulatorReview/OfflineSongs")
        do {
            let cache = try OfflineSongStorage(ownerID: owner, computerID: computer, root: root)
            var warm = APIRecord(raw: NativeReview.song.fields)
            warm["id"] = .string(String(repeating: "f", count: 64)); warm["title"] = .string("Saved performance fixture")
            try await store.offlineSongs.save([warm], computer: computer, complete: true)
            var held: CheckedContinuation<JSONValue, Never>?
            let reader = SongLibraryModel(store: store) { _ in await withCheckedContinuation { held = $0 } }
            let loading = Task { await reader.load(computerID: computer, group: "", query: "") }
            while held == nil { await Task.yield() }
            checks["savedSongsAreVisibleBeforeNetworkRefreshReturns"] = reader.items.map(\.id) == [warm.id]
            held?.resume(returning: .object(["items": .array([warm.value]), "total": .number(1), "updatedAt": .number(1)])); await loading.value
            var pages: [Int] = [], renderedBeforeLastPage = 0
            let songs = (0..<51).map { index -> APIRecord in
                var song = APIRecord(raw: NativeReview.song.fields)
                song["id"] = .string(String(format: "%064x", index)); song["title"] = .string("Performance fixture \(owner) \(index)")
                return song
            }
            let library = SongLibraryModel(store: store) { path in
                let offset = Int(URLComponents(string: path)?.queryItems?.first { $0.name == "offset" }?.value ?? "") ?? 0
                pages.append(offset)
                if offset == 50 {
                    let versions = try cache.existingPDFVersions(documents: URL.documentsDirectory.appending(path: "SimulatorReview"))
                    renderedBeforeLastPage = songs.filter { versions[$0.id] != nil }.count
                }
                return .object(["items": .array(songs.dropFirst(offset).prefix(50).map(\.value)), "total": .number(51), "updatedAt": .number(2)])
            }
            await library.load(computerID: computer, group: "", query: "")
            checks["nextNetworkPageDoesNotWaitForPDFConversion"] = renderedBeforeLastPage == 0
            checks["everyPageFinishesWithoutAUserLoadMoreAction"] = pages == [0,50] && library.items.count == 51 && !library.loading
            checks["completeCachedSourceReplacesThePreviousSnapshot"] = try cache.rows().count == 51 && !cache.rows().contains(where: { $0.id == warm.id })
            let gate = NativeWorkspaceProbe(); gate.block = true
            let cooling = OfflineSongs(store: store, allowsPDFWork: { !gate.block })
            defer { cooling.cancel(); store.offlineSongs.cancel() }
            var waiting = warm; waiting["id"] = .string(String(repeating: "e", count: 64))
            try await cooling.save([waiting], computer: computer)
            try await Task.sleep(for: .milliseconds(100))
            let documents = URL.documentsDirectory.appending(path: "SimulatorReview")
            checks["coolingPausesPDFWorkButKeepsOfflineLyrics"] = try cache.rows().contains(where: { $0.id == waiting.id }) && cache.existingPDFVersions(documents: documents)[waiting.id] == nil
            gate.block = false
            for _ in 0..<80 {
                if try cache.existingPDFVersions(documents: documents)[waiting.id] != nil { break }
                try await Task.sleep(for: .milliseconds(50))
            }
            checks["coolingQueueResumesWithoutAnotherDownload"] = try cache.existingPDFVersions(documents: documents)[waiting.id] != nil

        } catch { checks["fixtureCompleted"] = false }
        let report: [String: Any] = ["passed": checks.count == 6 && checks.values.allSatisfy { $0 }, "checks": checks,
            "scope": "Simulator actual library/cache/PDF scheduling with isolated synthetic owner and held network; no production data or measured physical latency"]
        if let bytes = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted,.sortedKeys]) { try? bytes.write(to: URL.applicationSupportDirectory.appending(path: "native-library-performance-checks.json"), options: .atomic) }
    }
}
#endif
