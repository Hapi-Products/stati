import Foundation
import Testing
@testable import StatiCore
@Suite struct GroupFileSnapshotTests {
    let privateFile = APIRecord(raw: ["id": .string("private"), "groupId": .string("group-a"), "title": .string("Private notes")])
    let legacyFile = APIRecord(raw: ["id": .string("legacy"), "title": .string("Legacy notes")])
    @Test func deniedFreshReadClearsMetadataPermissionsAndPreviewGeneration() {
        var value = GroupFileSnapshot()
        value.replace([privateFile, legacyFile], canUpload: true)
        value.invalidateAccess()
        #expect(value.files.isEmpty && !value.canUpload && value.accessRevision == 1)
    }
    @Test func incompleteMembershipListClearsPrivateRowsWithoutTouchingLegacyRows() {
        var value = GroupFileSnapshot()
        value.replace([privateFile, legacyFile], canUpload: true)
        value.validate(namedIDs: nil, selectedID: nil)
        #expect(value.files == [legacyFile] && value.accessRevision == 1)
        value.replace([privateFile, legacyFile], canUpload: true)
        #expect(value.files == [legacyFile])
    }
    @Test func removedScopedGroupCannotKeepUploadOrStalePageContents() {
        var value = GroupFileSnapshot()
        value.replace([privateFile], canUpload: true)
        value.validate(namedIDs: [], selectedID: "group-a")
        #expect(value.files.isEmpty && !value.canUpload && value.accessRevision == 1)
        value.replace([privateFile], canUpload: true)
        #expect(value.files.isEmpty && !value.canUpload)
    }
}
