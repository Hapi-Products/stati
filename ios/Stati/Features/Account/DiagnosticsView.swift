import SwiftUI

struct DiagnosticsView: View {
    @State private var entries = DiagnosticsLog.entries
    @State private var showsReport = false
    @State private var includeDiagnostics = false
    @State private var copied = false

    private var version: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Unknown"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "Unknown"
        return "\(version) (\(build))"
    }
    private var platform: String { UIDevice.current.userInterfaceIdiom == .pad ? "iPadOS" : "iOS" }
    private var appInfo: String { "Stați \(version) · \(platform) \(UIDevice.current.systemVersion)\nSiri AI preview — \(SiriPreviewAvailability.current.detail)" }
    private var report: String {
        ([appInfo, ""] + (entries.isEmpty ? ["No recent errors."] : entries)).joined(separator: "\n")
    }

    var body: some View {
        Form {
            Section("App Information") {
                LabeledContent("Version", value: version)
                LabeledContent(platform, value: UIDevice.current.systemVersion)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Siri AI preview")
                    Text(SiriPreviewAvailability.current.detail).foregroundStyle(.secondary)
                }
            }
            Section {
                Button("Copy diagnostics", systemImage: "document.on.document") {
                    UIPasteboard.general.string = report
                    copied = true
                }
                ShareLink(item: report) { Label("Share diagnostics", systemImage: "square.and.arrow.up") }
                Button("Report a problem", systemImage: "exclamationmark.bubble") {
                    includeDiagnostics = false
                    showsReport = true
                }
            } footer: {
                Text("GitHub issues are public. You can review your report before posting.")
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
                Text("Stați keeps up to 50 connection and server errors on this device. Entries contain the time, app area and error type.")
            }
        }
        .navigationTitle("Diagnostics")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Diagnostics copied", isPresented: $copied) { Button("OK", role: .cancel) {} }
        .sheet(isPresented: $showsReport) {
            NavigationStack {
                Form {
                    Section {
                        Toggle("Include recent errors", isOn: $includeDiagnostics)
                        Text(includeDiagnostics ? publicLog : appInfo)
                            .font(.footnote.monospaced())
                            .textSelection(.enabled)
                    } footer: {
                        Text("GitHub opens a draft you can edit. Add the steps to reproduce the problem there.")
                    }
                    if let issueURL {
                        Section { Link("Continue to GitHub", destination: issueURL) }
                    }
                }
                .navigationTitle("Report a Problem")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close", systemImage: "xmark") { showsReport = false }
                            .labelStyle(.iconOnly)
                    }
                }
            }
        }
    }

    private var publicLog: String { ([appInfo] + entries.prefix(10)).joined(separator: "\n") }
    private var issueURL: URL? {
        var url = URLComponents(string: "https://github.com/Hapi-Products/stati/issues/new")
        let details = includeDiagnostics ? publicLog : appInfo
        url?.queryItems = [URLQueryItem(name: "body", value: "### What happened?\n\n\n### Steps to reproduce\n\n\n### App information\n\n```\n\(details)\n```")]
        return url?.url
    }
}
