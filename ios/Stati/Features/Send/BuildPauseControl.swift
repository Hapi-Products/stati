import SwiftUI

struct BuildPauseControl: View {
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    let active: Bool
    @State private var status: Status?
    @State private var busy = false
    @State private var error = ""

    private struct Status {
        let manuallyPaused: Bool
        let serviceProtected: Bool

        init(_ value: JSONValue) throws {
            guard case let .bool(manual) = value["manualPaused"],
                  case let .bool(selected) = value["activeService"] else {
                throw APIError(status: 503, message: "Build status is unavailable.")
            }
            manuallyPaused = manual
            serviceProtected = selected || value["scheduledUntil"].number > 0
        }
    }

    var body: some View {
        Menu {
            if let status {
                if status.serviceProtected { Text("Builds are on hold during service.") }
                if status.manuallyPaused {
                    Button("Resume Builds", systemImage: "play.circle") { Task { await update(paused: false) } }
                } else {
                    Button("Pause Builds", systemImage: "pause.circle") { Task { await update(paused: true) } }
                }
            } else {
                Button("Check Build Status", systemImage: "arrow.clockwise") { Task { await update() } }
            }
        } label: {
            Label(status?.manuallyPaused == true || status?.serviceProtected == true ? "Builds on hold" : "Build controls",
                  systemImage: status?.manuallyPaused == true || status?.serviceProtected == true ? "pause.circle.fill" : "pause.circle")
                .labelStyle(.iconOnly)
        }
        .disabled(busy)
        .onChange(of: store.accountEpoch) { status = nil; error = ""; busy = false }
        .task(id: active && scenePhase == .active) {
            guard active, scenePhase == .active else { return }
            while !Task.isCancelled {
                await update(showError: false)
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
            }
        }
        .alert("Build Status", isPresented: Binding(get: { !error.isEmpty }, set: { if !$0 { error = "" } })) {
            Button("OK", role: .cancel) { error = "" }
        } message: { Text(error) }
    }

    private func update(paused: Bool? = nil, showError: Bool = true) async {
        guard store.isAdmin, !busy else { return }
        let epoch = store.accountEpoch
        busy = true
        defer { if epoch == store.accountEpoch { busy = false } }
        do {
            let data = try await store.api.request("/admin/build-pause", method: paused == nil ? "GET" : "PUT",
                                                   body: paused.map { .object(["paused": .bool($0)]) })
            guard epoch == store.accountEpoch, !Task.isCancelled else { return }
            status = try Status(data)
        } catch {
            guard epoch == store.accountEpoch, !Task.isCancelled else { return }
            status = nil
            if showError { self.error = error.localizedDescription }
        }
    }
}
