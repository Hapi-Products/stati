import Testing
@testable import StatiCore

struct ScanShareGateTests {
    @Test func scanCannotUploadUntilReviewClosesAndSharingIsExplicit() {
        var flow = ScanShareGate(), uploads = 0
        if flow.beginShare(scanID: "scan-a", uncertain: false) { uploads += 1 }
        #expect(uploads == 0)
        flow.finishReview(scanID: "scan-a")
        #expect(uploads == 0) // Closing the viewer has no upload side effect.
        #expect(flow.canShare(scanID: "scan-a", uncertain: false))
        if flow.beginShare(scanID: "scan-a", uncertain: false) { uploads += 1 }
        if flow.beginShare(scanID: "scan-a", uncertain: false) { uploads += 1 }
        #expect(uploads == 1)
    }
    @Test func reviewCannotAuthorizeAnotherScanOrUncertainRetry() {
        var flow = ScanShareGate()
        flow.finishReview(scanID: "scan-a")
        let otherScan = flow.beginShare(scanID: "scan-b", uncertain: false)
        #expect(!otherScan)
        let uncertainRetry = flow.beginShare(scanID: "scan-a", uncertain: true)
        #expect(!uncertainRetry)
        #expect(!ScanShareGate().canShare(scanID: "scan-a", uncertain: false))
    }
    @Test func explicitValidationRejectionAllowsCorrectionButUncertaintyStillBlocks() {
        var flow = ScanShareGate()
        let firstAttempt = flow.beginShare(scanID: nil, uncertain: false)
        #expect(firstAttempt) // Existing file picker needs no scan review.
        flow.allowCorrection()
        #expect(flow.canShare(scanID: nil, uncertain: false))
        #expect(!flow.canShare(scanID: nil, uncertain: true))
    }
}
