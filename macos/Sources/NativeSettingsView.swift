import SwiftUI
import AppKit

struct NativeSettingsView: View {
    @Bindable var model: WorkspaceModel
    @State private var computerName = ""
    @State private var diagnostics: JSONValue = .null
    @State private var checkingDiagnostics = false
    @State private var showingReport = false
    @State private var diagnosticsError = ""

    private var report: DiagnosticReport {
        DiagnosticReport(diagnostics,
                         appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "Preview",
                         build: Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "Development")
    }

    private var currentName: String { model.station["device"]["name"].string }
    private var trimmedName: String { computerName.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        Form {
            Section("This Mac") {
                LabeledContent("Computer name") {
                    HStack(spacing: 10) {
                        TextField("Computer name", text: $computerName)
                            .labelsHidden()
                            .textFieldStyle(.roundedBorder)
                            .frame(minWidth: 125, idealWidth: 210, maxWidth: 260)
                        Button("Save") {
                            Task { await model.command("computer-rename", [.string(trimmedName)], message: "Computer name saved.") }
                        }
                        .statiActionStyle()
                        .accessibilityLabel("Save computer name")
                        .disabled(trimmedName.isEmpty || trimmedName == currentName)
                    }
                    .disabled(!model.station["adminUnlocked"].bool)
                }
                LabeledContent("Downloads") {
                    Button("Open in Finder", systemImage: "folder") { Task { await model.command("downloads") } }
                }
            }

            Section("Connection") {
                LabeledContent("Diagnostics") {
                    HStack(spacing: 8) {
                        if checkingDiagnostics { ProgressView().controlSize(.small) }
                        Button("Run Diagnostics") { Task { await checkDiagnostics() } }
                            .disabled(checkingDiagnostics || !model.unlocked)
                        Button("Send to Developer…", systemImage: "paperplane") {
                            Task {
                                if diagnostics == .null && model.unlocked { await checkDiagnostics() }
                                showingReport = true
                            }
                        }
                        .disabled(checkingDiagnostics)
                    }
                }
                if diagnostics != .null {
                    LabeledContent("Connection", value: report.connection)
                }
                if !diagnosticsError.isEmpty {
                    Text(diagnosticsError).foregroundStyle(.secondary)
                }
            }

            Section("Notifications") {
                LabeledContent("Test alert") {
                    Button("Send Test") { Task { await model.command("notification-test") } }
                }
                LabeledContent("System Settings") {
                    Button("Open Settings", systemImage: "arrow.up.right") { Task { await model.command("notification-settings") } }
                }
            }

            Section("About Stați") {
                LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "Preview")
            }
        }
        .formStyle(.grouped)
        .frame(maxWidth: 680)
        .frame(minWidth: 460, maxWidth: .infinity, minHeight: 450)
        .sheet(isPresented: $showingReport) {
            DiagnosticReportSheet(report: report)
        }
        .onAppear { computerName = currentName }
        .onChange(of: currentName) { previous, next in
            if computerName == previous { computerName = next }
        }
    }

    private func checkDiagnostics() async {
        guard !checkingDiagnostics else { return }
        checkingDiagnostics = true
        defer { checkingDiagnostics = false }
        diagnosticsError = ""
        do { diagnostics = try await model.engine.call("connection-diagnostics") }
        catch {
            diagnostics = .null
            diagnosticsError = "The connection check couldn’t finish. You can still send the app and macOS versions."
        }
    }

}


private struct DiagnosticReportSheet: View {
    let report: DiagnosticReport
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Send Diagnostics to Developer").font(.title2.bold())
            Text("Review the report below, then open a draft in the public Stați GitHub issue tracker.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Text(report.text)
                .font(.system(.callout, design: .monospaced))
                .textSelection(.enabled)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.quaternary, in: .rect(cornerRadius: 8))
            HStack {
                Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                Button(copied ? "Copied" : "Copy Report") {
                    NSPasteboard.general.clearContents()
                    copied = NSPasteboard.general.setString(report.text, forType: .string)
                }
                if let url = report.issueURL {
                    Link("Open GitHub Draft", destination: url).statiActionStyle(prominent: true)
                }
            }
        }
        .padding(24)
        .frame(width: 460)
    }
}
