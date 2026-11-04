import Testing
@testable import StatiCore

struct IPadRoleAccessTests {
    @Test func restrictedRolesCannotEnterIPadWorkspace() {
        for role in ["commenter", "pastor"] { #expect(IPadRoleAccess.isBlocked(ministryRole: role, isPad: true)) }
    }
    @Test func restrictionDoesNotBlockIPhoneOrOtherIPadRoles() {
        for role in ["commenter", "pastor"] { #expect(!IPadRoleAccess.isBlocked(ministryRole: role, isPad: false)) }
        for role in ["", "admin", "worship_member", "worship_leader", "choir_director"] { #expect(!IPadRoleAccess.isBlocked(ministryRole: role, isPad: true)) }
    }
}
