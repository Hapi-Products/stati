import UIKit

/// Uses UIKit's selection highlight and handles after the sheet joins its window.
final class SongCorrectionTextView: UITextView {
    private var selectionOnArrival: NSRange?
    func prepareInitialSelection(_ range: NSRange) {
        selectionOnArrival = range
        setNeedsLayout()
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        guard window != nil, let range = selectionOnArrival, Range(range, in: text ?? "") != nil else { return }
        // Read-only text does not open a keyboard. Focus makes the native selection visible.
        guard becomeFirstResponder() else { return }
        selectionOnArrival = nil
        selectedRange = range
    }
}
