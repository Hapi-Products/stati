#if DEBUG && targetEnvironment(simulator)
import SwiftUI
import PDFKit

@MainActor enum NativeScanChecks {
    static var remoteDraft: GroupScanDraft?
    static var wrongBytes = false
    static var remoteGroupID: String?
    static var remoteGroupName: String?
    static var methods: [String] = []
    static let pdf: Data = {
        UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792)).pdfData { context in
            for index in 1...2 { context.beginPage(); ("Sample scan · Simulator checks only\nPage " + String(index)).draw(in: CGRect(x: 40, y: 40, width: 532, height: 120), withAttributes: [.font: UIFont.systemFont(ofSize: 20), .foregroundColor: UIColor.black]) }
        }
    }()
    static var materialList: JSONValue {
        guard let draft = remoteDraft else { return .object(["materials": .array([]), "nextCursor": .null]) }
        return .object(["materials": .array([.object(["id": .string("ab1e63b6-80e4-448a-a3ec-1cb61a129146"), "title": .string(draft.title), "filename": .string(draft.filename), "authorId": .string(draft.ownerID), "groupName": .string(remoteGroupName ?? draft.groupName), "groupId": remoteGroupID.map(JSONValue.string) ?? draft.groupID.map(JSONValue.string) ?? .null, "bytes": .number(Double(draft.bytes)), "fileUrl": .string("/api/group-materials/ab1e63b6-80e4-448a-a3ec-1cb61a129146/file")])]), "nextCursor": .null])
    }
    static func run(store: AppStore) async {
        var checks: [String: Bool] = [:]
        var created: GroupScanDraft?
        var namedCreated: GroupScanDraft?
        defer { if let created { try? GroupScanStorage.remove(created) }; if let namedCreated { try? GroupScanStorage.remove(namedCreated) }; remoteDraft = nil; wrongBytes = false; remoteGroupID = nil; remoteGroupName = nil }
        do {
            let data = pdf
            let draft = try GroupScanStorage.create(data: data, ownerID: NativeReview.userID, group: "Choir"); created = draft
            let file = try GroupScanStorage.verifiedFile(draft)
            let protectedCopy = try Data(contentsOf: file)
            checks["twoPagePDFAndExactProtectedCopy"] = PDFDocument(data: data)?.pageCount == 2 && protectedCopy == data
            var uncertain = draft; uncertain.sharingUnconfirmed = true; uncertain.title = "Sample scan notes"; try GroupScanStorage.save(uncertain)
            let reopened = try GroupScanStorage.load(ownerID: draft.ownerID).first { $0.id == draft.id }
            checks["uncertainShareSurvivesRestart"] = reopened?.sharingUnconfirmed == true && reopened?.title == uncertain.title
            let metadata = try GroupScanStorage.directory(ownerID: draft.ownerID).appending(path: draft.id + ".json")
            let originalMetadata = try Data(contentsOf: metadata)
            try Data("{broken".utf8).write(to: metadata, options: [.atomic])
            do { _ = try GroupScanStorage.load(ownerID: draft.ownerID); checks["corruptMetadataPreservesPDF"] = false } catch {
                let retainedCopy = try Data(contentsOf: file)
                checks["corruptMetadataPreservesPDF"] = FileManager.default.fileExists(atPath: file.path) && retainedCopy == data
            }
            try originalMetadata.write(to: metadata, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            remoteDraft = uncertain; methods = []
            checks["sharedScanReconcilesByExactBytes"] = try await GroupScanReconciler.find(draft: uncertain, store: store)
            wrongBytes = true
            checks["mismatchedBytesNeverConfirmDelivery"] = !(try await GroupScanReconciler.find(draft: uncertain, store: store))
            checks["reconciliationNeverPostsAnotherCopy"] = !methods.isEmpty && methods.allSatisfy { $0 == "GET" }
            wrongBytes = false
            let named = try GroupScanStorage.create(data: data, ownerID: NativeReview.userID, group: "Before rename", groupID: NativeReview15.groupID); namedCreated = named
            remoteDraft = named; remoteGroupName = "After rename"
            checks["namedGroupReconcilesAcrossGroupRename"] = try await GroupScanReconciler.find(draft: named, store: store)
            remoteGroupID = UUID().uuidString.lowercased()
            checks["anotherGroupNeverConfirmsTheSameBytes"] = !(try await GroupScanReconciler.find(draft: named, store: store))
            checks["namedGroupIDSurvivesProtectedRestart"] = try GroupScanStorage.load(ownerID: named.ownerID).first(where: { $0.id == named.id })?.groupID == NativeReview15.groupID
            try GroupScanStorage.remove(draft); try GroupScanStorage.remove(draft)
            checks["confirmedCleanupIsIdempotent"] = !FileManager.default.fileExists(atPath: file.path) && !FileManager.default.fileExists(atPath: metadata.path)
        } catch { checks["noUnexpectedError"] = false }
        let report: [String: Any] = ["passed": checks.count == 10 && checks.values.allSatisfy { $0 }, "checks": checks, "groupMaterialRequestMethods": methods, "scope": "Simulator scan draft persistence, corruption, PDF-byte reconciliation and cleanup model/I-O; no camera, UI gestures or real group mutations"]
        let target = URL.applicationSupportDirectory.appending(path: "native-scan-checks.json")
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: target, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
    }
}
#endif
