#if DEBUG && targetEnvironment(simulator)
import SwiftUI

@MainActor enum NativeReviewTaskImage {
    static let id = "6ba6dd35-835d-48d7-bfd1-0753c596d8b3"
    static var record: JSONValue { record(1) }
    static func record(_ index: Int) -> JSONValue { .object(["id": .string(index == 1 ? id : "6ba6dd35-835d-48d7-bfd1-0753c596d8b" + String(index + 3)), "filename": .string("sample-task-" + String(index) + ".png"), "url": .string("/api/tasks/" + NativeReview.task["id"].text + "/images/" + (index == 1 ? id : "6ba6dd35-835d-48d7-bfd1-0753c596d8b" + String(index + 3))), "canRemove": .bool(NativeReview.route != "task-readonly")]) }
    static var png: Data {
        UIGraphicsImageRenderer(size: CGSize(width: 800, height: 400)).image { context in
            UIColor.white.setFill(); context.fill(CGRect(x: 0, y: 0, width: 800, height: 400))
            ("Sample task image\nSimulator review only\n\nMicrophone setup notes").draw(in: CGRect(x: 40, y: 50, width: 720, height: 300), withAttributes: [.font: UIFont.systemFont(ofSize: 32), .foregroundColor: UIColor.black])
        }.pngData()!
    }
}
#endif
