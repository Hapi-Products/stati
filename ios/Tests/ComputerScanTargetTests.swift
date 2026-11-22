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

struct Ilumin8ClickerLinkTests {
    private let token = String(repeating: "a1", count: 24)

    @Test func preservesTheClickerInviteAndShowsOnlyTheComputerAddress() {
        for address in ["presentation.local:9443", "192.168.1.10:9443", "[fd00::10]:9443", "presentation.local"] {
            let value = "https://\(address)/remote#\(token)"
            let clicker = Ilumin8ClickerLink(value)
            #expect(clicker?.computerAddress == address)
            #expect(clicker?.url.absoluteString == value)
            #expect(ComputerScanTarget(value) == nil)
        }
    }

    @Test func bindsTheProfileTicketToTheScannedInviteWithoutSendingItInTheQuery() {
        let station = "8868b39c-63aa-45c5-9e13-497348240bdb"
        let url = "https://presentation.local:9443/remote?stati=\(station)#\(token)"
        let link = Ilumin8ClickerLink(url)
        let ticket = String(repeating: "p", count: 43)
        #expect(link?.stationID == station)
        #expect(link?.binding?.count == 64)
        #expect(link?.sharingProfile(ticket: ticket)?.query == "stati=\(station)")
        #expect(link?.sharingProfile(ticket: ticket)?.fragment == token + "?profile=" + ticket)
        #expect(link?.sharingProfile(ticket: "invalid") == nil)
        #expect(Ilumin8ClickerLink(url + "?profile=" + ticket) == nil)
    }

    @Test func rejectsAnythingOtherThanAnExactHttpsClickerInvite() {
        for value in [
            "http://presentation.local:9443/remote#\(token)",
            "https://user@presentation.local:9443/remote#\(token)",
            "https://@presentation.local:9443/remote#\(token)",
            "https://presentation.local:9443/remote?#\(token)",
            "https://presentation.local:9443/other/../remote#\(token)",
            "https://presentation.local:9443/%72emote#\(token)",
            "https://presentation.local:9443/remote/#\(token)",
            "https://presentation.local:9443/remote#%61\(token.dropFirst())",
            "https://presentation.local:9443/remote#\(token.uppercased())",
            "https://presentation.local:9443/remote#\(token.dropLast())",
            "https://presentation.local:9443/remote#\(token)\n",
            "https://presentation.local:65536/remote#\(token)",
            "https://127.1:9443/remote#\(token)",
            "https://[1::2::3]:9443/remote#\(token)",
        ] { #expect(Ilumin8ClickerLink(value) == nil) }
    }
}
