import UIKit

final class FileImageScrollView: UIScrollView {
    weak var canvas: UIImageView?
    private var lastSize = CGSize.zero
    override func layoutSubviews() {
        super.layoutSubviews()
        guard let canvas, bounds.width > 0, bounds.height > 0 else { return }
        if lastSize != bounds.size {
            lastSize = bounds.size
            setZoomScale(1, animated: false)
            canvas.frame = CGRect(origin: .zero, size: bounds.size)
            contentSize = bounds.size
        }
        canvas.center = CGPoint(x: max(bounds.width, contentSize.width) / 2, y: max(bounds.height, contentSize.height) / 2)
    }
}
