#if DEBUG && targetEnvironment(simulator)
import SwiftUI

@MainActor enum NativeReviewMaterial {
    static let id = "4ba6dd35-835d-48d7-bfd1-0753c596d8b3"
    static let secondID = "7ba6dd35-835d-48d7-bfd1-0753c596d8b3"
    static var file: JSONValue { row(id, title: "Amazing Grace · Chord sheet", group: "Choir") }
    static var secondFile: JSONValue { row(secondID, title: "Amazing Grace · Guitar notes", group: "Worship group") }
    static func row(_ id: String, title: String, group: String) -> JSONValue {
        .object(["id": .string(id), "title": .string(title), "groupName": .string(group), "filename": .string("Choir.pdf"), "contentType": .string("application/pdf"), "fileUrl": .string("/api/group-materials/" + id + "/file"), "authorName": .string("Sample M."), "canDelete": .bool(true)])
    }
    static let pdf: Data = {
        UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792)).pdfData { context in
            context.beginPage()
            let chart = "Amazing Grace\nOriginal key: G\n\nG       D/F#       Em7       C\nAmazing grace, how sweet the sound"
            let text = NativeReview.route == "ipad-chord-chart" ? chart : "Sample shared notes\nSimulator review only\n\nAmazing Grace\nChoir chord sheet\n\nThis is labelled sample material, not a church upload."
            text.draw(in: CGRect(x: 48, y: 64, width: 516, height: 664), withAttributes: [.font: UIFont.monospacedSystemFont(ofSize: 20, weight: .regular), .foregroundColor: UIColor.black])
        }
    }()
}
#endif
