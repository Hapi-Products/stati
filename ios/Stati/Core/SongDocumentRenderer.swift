import UIKit
import CoreText

@MainActor enum SongDocumentRenderer {
    static func document(text: String, columns: PDFColumnCount = .one) throws -> Data {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw failure() }
        let bounds = CGRect(x: 0, y: 0, width: 612, height: 792), paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = 6
        let attributed = NSAttributedString(string: text, attributes: [.font: UIFont.systemFont(ofSize: 18), .foregroundColor: UIColor.black, .paragraphStyle: paragraph])
        let framesetter = CTFramesetterCreateWithAttributedString(attributed as CFAttributedString)
        var start = 0, failed = false
        let data = UIGraphicsPDFRenderer(bounds: bounds).pdfData { context in
            while start < attributed.length && !failed {
                context.beginPage(); UIColor.white.setFill(); context.cgContext.fill(bounds)
                context.cgContext.saveGState(); context.cgContext.translateBy(x: 0, y: bounds.height); context.cgContext.scaleBy(x: 1, y: -1)
                let area = bounds.insetBy(dx: 36, dy: 36), gutter: CGFloat = 24
                let width = (area.width - CGFloat(columns.rawValue - 1) * gutter) / CGFloat(columns.rawValue)
                for column in 0..<columns.rawValue where start < attributed.length {
                    let rect = CGRect(x: area.minX + CGFloat(column) * (width + gutter), y: area.minY, width: width, height: area.height)
                    let path = CGPath(rect: rect, transform: nil)
                    let frame = CTFramesetterCreateFrame(framesetter, CFRange(location: start, length: 0), path, nil)
                    let visible = CTFrameGetVisibleStringRange(frame)
                    guard visible.length > 0 else { failed = true; break }
                    CTFrameDraw(frame, context.cgContext); start += visible.length
                }
                context.cgContext.restoreGState()
            }
        }
        guard !failed, start == attributed.length else { throw failure() }
        return data
    }
    static func slides(pages: [String]) throws -> Data {
        guard !pages.isEmpty else { throw failure() }
        let bounds = CGRect(x: 0, y: 0, width: 1024, height: 576), area = bounds.insetBy(dx: 48, dy: 40)
        let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .center
        let layouts = try pages.map { text -> (String, CGFloat, CGFloat) in
            var size: CGFloat = 48
            func measured() -> CGRect {
                (text as NSString).boundingRect(with: CGSize(width: area.width, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: UIFont.systemFont(ofSize: size, weight: .medium), .paragraphStyle: paragraph], context: nil)
            }
            while size > 18 && measured().height > area.height { size -= 1 }
            guard measured().height <= area.height else { throw APIError(status: 413, message: "One slide has too much text to stay readable. Share a PDF document instead.") }
            return (text, size, measured().height)
        }
        return UIGraphicsPDFRenderer(bounds: bounds).pdfData { context in
            for (text, size, height) in layouts {
                context.beginPage(); UIColor.black.setFill(); context.cgContext.fill(bounds)
                let attributes: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: size, weight: .medium), .foregroundColor: UIColor.white, .paragraphStyle: paragraph]
                (text as NSString).draw(with: CGRect(x: area.minX, y: area.midY - height / 2, width: area.width, height: height), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attributes, context: nil)
            }
        }
    }

    private static func failure() -> APIError { APIError(status: 409, message: "The song document could not be prepared. Reopen this song and try again.") }
}
