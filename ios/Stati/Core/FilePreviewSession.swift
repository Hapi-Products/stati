import SwiftUI

@MainActor @Observable final class FilePreviewSession {
    private(set) var url: URL?
    private(set) var image: UIImage?
    private(set) var text: String?
    private(set) var loading = false
    private(set) var message = ""
    private var generation = UUID()
    func load(_ item: FilePreviewItem, api: APIClient, ownerID: String? = nil, resources: FileResourceCache? = nil, resourceOwner: String = "", decodeContents: Bool = true, isCurrent: @escaping @MainActor () -> Bool) async {
        close()
        let scope = generation
        guard isCurrent() else { return }
        loading = true
        do {
            let original: URL
            if let ownerID, let local = try FileMarkupStorage.latest(ownerID: ownerID, path: item.path), local.needsSync {
                let data = try Data(contentsOf: FileMarkupStorage.verifiedFile(local))
                original = try NativePreview.stage(data: data, filename: local.filename)
            } else if let resources {
                let bytes = try await resources.bytes(key: resources.key(owner: resourceOwner, item: item), filename: item.filename) { try await api.bytes(item.path) }
                original = try NativePreview.stage(data: bytes, filename: item.filename)
            } else { original = try await NativePreview.download(api: api, path: item.path, filename: item.filename) }
            guard !Task.isCancelled, scope == generation, isCurrent() else { NativePreview.remove(original); return }
            var adopted = false
            defer { if !adopted { NativePreview.remove(original) } }
            let data = try Data(contentsOf: original, options: .mappedIfSafe)
            image = decodeContents ? PreviewImage.decode(data, maximumPixels: 4096) : nil
            if decodeContents && image == nil && ["txt", "md", "csv", "log"].contains(original.pathExtension.lowercased()), data.count <= 8 * 1024 * 1024 { text = String(data: data, encoding: .utf8) }
            url = original; adopted = true
        } catch is CancellationError { }
        catch { if scope == generation && isCurrent() { message = error.localizedDescription } }
        if scope == generation { loading = false }
    }
    func fail(_ text: String) { close(); message = text }
    func close() {
        generation = UUID()
        if let url { NativePreview.remove(url) }
        url = nil; image = nil; text = nil; loading = false; message = ""
    }
}
