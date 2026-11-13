import SwiftUI
import UniformTypeIdentifiers

struct DiagnosticsView: View {
    @Environment(AppStore.self) private var store
    @State private var entries = DiagnosticsLog.entries
    @State private var showsReport = false
    @State private var confirmsSend = false
    @State private var reporting = false
    @State private var description = ""
    @State private var reportError: String?
    @State private var notice: String?

    private var version: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Unknown"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "Unknown"
        return "\(version) (\(build))"
    }

    private var platform: String { UIDevice.current.userInterfaceIdiom == .pad ? "iPadOS" : "iOS" }
    private var systemVersion: String { UIDevice.current.systemVersion }
    private var siriStatus: String { SiriPreviewAvailability.current.detail }
    private var appInfo: String { "Stați \(version) · \(platform) \(systemVersion)\nSiri AI preview — \(siriStatus)" }

    var body: some View {
        Form {
            Section("App Information") {
                LabeledContent {
                    Text(version).textSelection(.enabled)
                } label: {
                    Label("Version", systemImage: "app")
                }
                .contextMenu {
                    Button("Copy version", systemImage: "doc.on.doc") { UIPasteboard.general.string = version }
                }
                LabeledContent { Text(systemVersion) } label: { Label(platform, systemImage: platform == "iPadOS" ? "ipad" : "iphone") }
                VStack(alignment: .leading, spacing: 4) {
                    Label("Siri AI preview", systemImage: "sparkles")
                    Text(siriStatus).foregroundStyle(.secondary)
                }
            }
            Section {
                Button("Report a problem", systemImage: "exclamationmark.bubble") {
                    reportError = nil
                    description = ""
                    showsReport = true
                }
            } footer: {
                Text("Reports go to the Stați support team and include recent errors.")
            }
            Section {
                if entries.isEmpty {
                    Text("No recent errors.").foregroundStyle(.secondary)
                }
                ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
                    Text(entry).font(.footnote.monospaced()).textSelection(.enabled)
                }
            } header: {
                Text("Recent errors")
            } footer: {
                Text("Entries expire after 24 hours. Each shows the time, app area and type of error.")
            }
        }
        .navigationTitle("Diagnostics")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Copy diagnostics", systemImage: "doc.on.doc", action: copyDiagnostics)
                    .labelStyle(.iconOnly)
            }
        }
        .onAppear { entries = DiagnosticsLog.entries }
        .alert(notice ?? "", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
            Button("OK", role: .cancel) {}
        }
        .sheet(isPresented: $showsReport) { reportSheet }
    }

    private var reportSheet: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("What happened? (optional)", text: $description, axis: .vertical)
                        .lineLimit(3...8)
                        .onChange(of: description) { _, value in
                            if value.count > 2_000 { description = String(value.prefix(2_000)) }
                        }
                } footer: {
                    Text("Add what you were doing when the problem happened.")
                }
                Section {
                    Label("Recent errors included", systemImage: "checkmark.shield")
                } footer: {
                    Text("Stați sends your description, app information and up to 200 recent errors privately to the support team.")
                }
                if reporting { ProgressView("Sending report…") }
                if let reportError { Text(reportError).foregroundStyle(.secondary) }
            }
            .navigationTitle("Report a Problem")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") { showsReport = false }
                        .labelStyle(.iconOnly)
                        .disabled(reporting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Review and send", systemImage: "checkmark") { confirmsSend = true }
                        .labelStyle(.iconOnly)
                        .disabled(reporting)
                }
            }
            .alert("Send this report?", isPresented: $confirmsSend) {
                Button("No", role: .cancel) {}
                Button("Yes, Send") { Task { await sendReport() } }
            } message: {
                Text("The Stați support team will receive your report and recent errors.")
            }
        }
        .interactiveDismissDisabled(reporting)
    }

    private func copyDiagnostics() {
        entries = DiagnosticsLog.entries
        let errors = entries.isEmpty ? ["No recent errors."] : entries
        UIPasteboard.general.setItems([[UTType.plainText.identifier: ([appInfo, ""] + errors).joined(separator: "\n")]],
                                     options: [.localOnly: true, .expirationDate: Date.now.addingTimeInterval(600)])
        notice = "Diagnostics copied"
    }

    private func sendReport() async {
        guard !reporting else { return }
        reporting = true
        reportError = nil
        defer { reporting = false }
        entries = DiagnosticsLog.entries
        let report: JSONValue = .object([
            "description": .string(description),
            "version": .string(version),
            "platform": .string(platform),
            "systemVersion": .string(systemVersion),
            "siriStatus": .string(SiriPreviewAvailability.current.rawValue),
            "recentErrors": .array(entries.prefix(200).map(JSONValue.string)),
            "errorCount": .number(Double(entries.count)),
        ])
        do {
            let response = try await store.api.request("/support/reports", method: "POST", body: report)
            guard response["ok"].flag else { throw APIError(status: 0, message: "Stați could not confirm that the report was received.") }
            showsReport = false
            description = ""
            notice = "Report sent"
        } catch is CancellationError {
            return
        } catch {
            reportError = error.localizedDescription
        }
    }
}
