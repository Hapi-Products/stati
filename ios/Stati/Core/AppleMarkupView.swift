import SwiftUI
import QuickLook

/// Quick Look is the sole preview and owns its native Markup action.
struct AppleMarkupView: UIViewControllerRepresentable {
    let url: URL
    let filename: String
    var canEdit = true
    var navigate: ((Int) -> Void)? = nil
    let saved: (URL) -> Void
    let close: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator(url: url, filename: filename, canEdit: canEdit, saved: saved, close: close) }
    func makeUIViewController(context: Context) -> UINavigationController {
        let preview = DocumentPreviewController(); preview.dataSource = context.coordinator; preview.delegate = context.coordinator
        let closeAction = UIAction { _ in context.coordinator.close() }
        preview.navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: UIDevice.current.userInterfaceIdiom == .pad ? .close : .done, primaryAction: closeAction)
        let navigation = DocumentNavigationController(rootViewController: preview); navigation.navigationBar.tintColor = UIColor(named: "AccentColor"); navigation.view.tintColor = UIColor(named: "AccentColor"); navigation.navigate = navigate; return navigation
    }
    func updateUIViewController(_ view: UINavigationController, context: Context) { context.coordinator.canEdit = canEdit; (view as? DocumentNavigationController)?.navigate = navigate }
    final class Coordinator: NSObject, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
        let item: MarkupPreviewItem
        var canEdit: Bool
        let saved: (URL) -> Void
        let close: () -> Void
        init(url: URL, filename: String, canEdit: Bool, saved: @escaping (URL) -> Void, close: @escaping () -> Void) { item = MarkupPreviewItem(url: url, title: filename); self.canEdit = canEdit; self.saved = saved; self.close = close }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> any QLPreviewItem { item }
        func previewController(_ controller: QLPreviewController, editingModeFor previewItem: any QLPreviewItem) -> QLPreviewItemEditingMode { canEdit ? .createCopy : .disabled }
        func previewController(_ controller: QLPreviewController, didSaveEditedCopyOf previewItem: any QLPreviewItem, at modifiedContentsURL: URL) { saved(modifiedContentsURL) }
    }
}
