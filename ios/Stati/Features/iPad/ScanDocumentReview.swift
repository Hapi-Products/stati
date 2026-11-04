import SwiftUI

struct ScanDocumentReview: View {
    @Environment(\.dismiss) private var dismiss
    let url: URL
    let title: String
    var body: some View {
        NavigationStack {
            FilePDFCanvas(url: url).navigationTitle(title).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close scan", systemImage: "xmark") { dismiss() }.labelStyle(ActionIconLabelStyle()) } }
        }
        .task {
            #if DEBUG && targetEnvironment(simulator)
            // Render the post-close state through the same dismissal callback as Close.
            if NativeReview.route == "ipad-scan-form" {
                do { try await Task.sleep(for: .seconds(1)); dismiss() } catch { }
            }
            #endif
        }
    }
}
