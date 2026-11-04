import Foundation

enum IPadRoleAccess {
    static func isBlocked(ministryRole: String, isPad: Bool) -> Bool {
        isPad && ["commenter", "pastor"].contains(ministryRole)
    }
}
