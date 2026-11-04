import Testing
@testable import StatiCore
struct ComputerScanTargetTests {
    @Test func acceptsOnlyChurchComputerInvitesAndReceiverCodes() {
        #expect(ComputerScanTarget("123456") == .code("123456"))
        #expect(ComputerScanTarget("https://stati.ciani01.org/#join=123456") == .code("123456"))
        #expect(ComputerScanTarget("https://stati.ciani01.org/send/aBcDef0123_-4567") == .receiver("aBcDef0123_-4567"))
    }
    @Test func acceptsInitialPairingOnlyOnTheTrustedOrigin() {
        #expect(ComputerScanTarget("https://stati.ciani01.org/pair/aBcDef0123_-4567") == .pairing("aBcDef0123_-4567"))
        for value in ["https://evil.test/pair/aBcDef0123_-4567", "https://stati.ciani01.org/pair/aBcDef0123_-4567?redirect=bad", "https://stati.ciani01.org/pair/aBcDef0123_-4567#fragment", "https://stati.ciani01.org/pair/aBcDef0123_-4567/extra", "https://stati.ciani01.org/pair/short"] { #expect(ComputerScanTarget(value) == nil) }
    }
    @Test func rejectsForeignDestinationsAndPairingCredentials() {
        for value in ["https://evil.test/#join=123456", "https://stati.ciani01.org.evil.test/#join=123456", "https://stati.ciani01.org/pair/secret", "http://stati.ciani01.org/#join=123456", "https://user@stati.ciani01.org/#join=123456", "https://stati.ciani01.org:444/#join=123456", "https://stati.ciani01.org/#join=１２３４５６", "https://stati.ciani01.org/send/aBcDef0123_-4567?redirect=bad", "https://stati.ciani01.org/send/../private", "12345"] { #expect(ComputerScanTarget(value) == nil) }
    }
}
