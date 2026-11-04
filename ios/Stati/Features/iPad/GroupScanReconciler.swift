import Foundation
import CryptoKit

@MainActor enum GroupScanReconciler {
    static func find(draft: GroupScanDraft, store: AppStore) async throws -> Bool {
        let epoch = store.accountEpoch
        guard store.me?.id == draft.ownerID else { throw CancellationError() }
        var cursor = ""
        for _ in 0..<10 {
            let destination = draft.groupID.map { "groupId=" + $0.queryEncoded } ?? "groupName=" + draft.groupName.queryEncoded
            let page = try await store.api.request("/group-materials?" + destination + (cursor.isEmpty ? "" : "&before=" + cursor.queryEncoded))
            try Task.checkCancellation()
            guard store.me?.id == draft.ownerID, store.accountEpoch == epoch else { throw CancellationError() }
            for file in page["materials"].records where file["authorId"].text == draft.ownerID && file["filename"].text == draft.filename && Int(file["bytes"].number) == draft.bytes && normalized(file.title) == normalized(draft.title) && (draft.groupID.map { file["groupId"].text == $0 } ?? (file["groupId"].text.isEmpty && normalized(file["groupName"].text).lowercased() == normalized(draft.groupName).lowercased())) && !file["removalPending"].flag {
                guard let item = FilePreviewItem(record: file, pathKey: "fileUrl") else { continue }
                let bytes = try await store.api.bytes(item.path)
                guard store.me?.id == draft.ownerID, store.accountEpoch == epoch else { throw CancellationError() }
                if SHA256.hash(data: bytes).map({ String(format: "%02x", $0) }).joined() == draft.sha256 { return true }
            }
            cursor = page["nextCursor"].text
            if cursor.isEmpty { break }
        }
        return false
    }
    private static func normalized(_ value: String) -> String { value.precomposedStringWithCompatibilityMapping.trimmingCharacters(in: .whitespacesAndNewlines) }
}
