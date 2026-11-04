import Foundation

nonisolated struct GroupFileSnapshot {
    private(set) var files: [APIRecord] = []
    private(set) var canUpload = false
    private(set) var accessRevision = 0
    private var validatedGroups: Set<String>?
    private var scopedUnavailable = false
    mutating func replace(_ rows: [APIRecord], canUpload: Bool, more: Bool = false) {
        let allowed = rows.filter { row in row["groupId"].text.isEmpty || validatedGroups.map { $0.contains(row["groupId"].text) } ?? true }
        files = more ? files + allowed.filter { row in !files.contains(where: { $0.id == row.id }) } : allowed
        self.canUpload = canUpload && !scopedUnavailable
    }
    mutating func invalidateAccess() { files = []; canUpload = false; accessRevision += 1 }
    mutating func validate(namedIDs: Set<String>?, selectedID: String?) {
        validatedGroups = namedIDs ?? []
        scopedUnavailable = selectedID.map { !(namedIDs?.contains($0) ?? false) } ?? false
        let previous = files
        if scopedUnavailable { files = []; canUpload = false }
        else { files.removeAll { !$0["groupId"].text.isEmpty && !(namedIDs?.contains($0["groupId"].text) ?? false) } }
        if files != previous || scopedUnavailable { accessRevision += 1 }
    }
}
