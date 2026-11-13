import SwiftUI

struct ClickerRehearsalView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let receives: Bool

    @State private var receiver = UUID()
    @State private var starting = false
    @State private var page: Int?
    @State private var message = ""
    @State private var elapsed = 0.0
    @State private var attempted = 0
    @State private var received = 0
    @State private var roundTrip: Double?

    private var path: String { "/computers/" + store.selectedComputer + "/clicker-rehearsal" }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(receives
                         ? "Leave this screen open, then start Clicker Test on your iPhone using the same profile and computer."
                         : "Open Clicker Test on the iPad. Stați will send five sample pages over ten seconds.")
                }
                if let page {
                    Section { Label("Test page \(page + 1)", systemImage: "rectangle.on.rectangle") }
                }
                if !receives {
                    Section {
                        if starting {
                            ProgressView(value: elapsed, total: 10) { Text("Testing connection…") }
                        } else {
                            Button("Start ten-second test", systemImage: "play.circle") { starting = true }
                        }
                        if attempted > 0 {
                            LabeledContent("Pages acknowledged", value: "\(received) of \(attempted)")
                        }
                        if let roundTrip {
                            LabeledContent("Median delivery and acknowledgment", value: "\(Int(roundTrip)) ms")
                        }
                    }
                }
                if !message.isEmpty { Section { Text(message).foregroundStyle(.secondary) } }
            }
            .navigationTitle("Clicker Test")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) {
                Button("Close", systemImage: "xmark") { dismiss() }.labelStyle(.iconOnly)
            } }
        }
        .task(id: path + String(receives || starting)) {
            guard !store.selectedComputer.isEmpty else { message = "Choose a computer first."; return }
            if receives { await receive(on: path) }
            else if starting { await send(on: path) }
        }
    }

    private func command(_ action: String, to path: String, fields: [String: JSONValue]) async throws {
        var payload = fields
        payload["action"] = .string(action)
        _ = try await store.api.request(path, method: "POST", body: .object(payload))
    }

    private func receive(on path: String) async {
        let clock = ContinuousClock()
        var nextArm = clock.now
        let token = JSONValue.string(receiver.uuidString.lowercased())
        var run = ""
        var lastSequence = 0
        do {
            while !Task.isCancelled {
                if clock.now >= nextArm {
                    try await command("arm", to: path, fields: ["receiver": token])
                    nextArm = clock.now + .seconds(5)
                    if run.isEmpty { message = "Ready for the iPhone" }
                }
                let test = try await store.api.request(path)
                let active = test["run"].text
                if active != run {
                    run = active
                    lastSequence = 0
                    if active.isEmpty { page = nil; message = "Ready for the iPhone" }
                }
                for sample in test["samples"].items {
                    guard let sequence = Int(exactly: sample["sequence"].number), sequence > lastSequence,
                          let next = Int(exactly: sample["page"].number), !active.isEmpty else { continue }
                    page = next
                    await Task.yield()
                    try await command("ack", to: path, fields: [
                        "receiver": token, "run": .string(active), "sequence": .number(Double(sequence))
                    ])
                    lastSequence = sequence
                    message = "Received test page \(next + 1)"
                }
                try await clock.sleep(for: active.isEmpty ? .seconds(1) : .milliseconds(250))
            }
        } catch is CancellationError { }
        catch { if !Task.isCancelled { message = error.localizedDescription } }
    }

    private func send(on path: String) async {
        defer { starting = false }
        attempted = 0; received = 0; roundTrip = nil; elapsed = 0; message = ""
        let clock = ContinuousClock()
        let run = UUID().uuidString.lowercased()
        do {
            try await command("start", to: path, fields: ["run": .string(run)])
            let start = clock.now
            for (index, target) in [1, 4, 2, 6, 0].enumerated() {
                try await clock.sleep(until: start + .seconds(index * 2))
                guard clock.now < start + .seconds(10) else { break }
                attempted += 1
                try await command("sample", to: path, fields: [
                    "run": .string(run), "sequence": .number(Double(index + 1)), "page": .number(Double(target))
                ])
                elapsed = Double(index * 2)
                page = target
            }
            try await clock.sleep(until: start + .seconds(10))
            elapsed = 10
            let receipt = try await store.api.request(path)
            guard receipt["run"].text == run else { message = "The test ended before results arrived."; return }
            let durations = receipt["samples"].items.compactMap { sample -> Double? in
                guard case .number(let acknowledged) = sample["acknowledgedAt"] else { return nil }
                return acknowledged - sample["sentAt"].number
            }.sorted()
            received = durations.count
            if !durations.isEmpty {
                roundTrip = (durations[(durations.count - 1) / 2] + durations[durations.count / 2]) / 2
            }
            message = received == 5 ? "The iPad acknowledged all five pages." : "Some test pages did not reach the iPad in time."
        } catch is CancellationError { }
        catch { if !Task.isCancelled { message = error.localizedDescription } }
    }
}
