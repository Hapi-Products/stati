import SwiftUI

struct ZoomableFileImage: UIViewRepresentable {
    let image: UIImage
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> FileImageScrollView {
        let scroll = FileImageScrollView()
        scroll.delegate = context.coordinator; scroll.minimumZoomScale = 1; scroll.maximumZoomScale = 5
        scroll.showsHorizontalScrollIndicator = false; scroll.showsVerticalScrollIndicator = false
        let canvas = UIImageView(); canvas.contentMode = .scaleAspectFit; canvas.accessibilityIgnoresInvertColors = true
        scroll.addSubview(canvas); scroll.canvas = canvas; context.coordinator.canvas = canvas
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.doubleTap(_:))); tap.numberOfTapsRequired = 2; scroll.addGestureRecognizer(tap)
        return scroll
    }
    func updateUIView(_ scroll: FileImageScrollView, context: Context) {
        guard let canvas = context.coordinator.canvas else { return }
        if canvas.image !== image { scroll.setZoomScale(1, animated: false); canvas.image = image }
        context.coordinator.layout(scroll)
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: FileImageScrollView, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? 300, height: proposal.height ?? 300)
    }
    final class Coordinator: NSObject, UIScrollViewDelegate {
        var canvas: UIImageView?
        func viewForZooming(in scrollView: UIScrollView) -> UIView? { canvas }
        func scrollViewDidZoom(_ scrollView: UIScrollView) { center(scrollView) }
        func layout(_ scroll: UIScrollView) {
            guard let canvas, scroll.bounds.width > 0, scroll.bounds.height > 0 else { return }
            if canvas.bounds.size != scroll.bounds.size && scroll.zoomScale == 1 { canvas.frame = CGRect(origin: .zero, size: scroll.bounds.size); scroll.contentSize = scroll.bounds.size }
            center(scroll)
        }
        private func center(_ scroll: UIScrollView) {
            guard let canvas else { return }
            canvas.center = CGPoint(x: max(scroll.bounds.width, scroll.contentSize.width) / 2, y: max(scroll.bounds.height, scroll.contentSize.height) / 2)
        }
        @objc func doubleTap(_ gesture: UITapGestureRecognizer) {
            guard let scroll = gesture.view as? UIScrollView, let canvas else { return }
            if scroll.zoomScale > 1 { scroll.setZoomScale(1, animated: !UIAccessibility.isReduceMotionEnabled) }
            else {
                let point = gesture.location(in: canvas), size = CGSize(width: scroll.bounds.width / 2.5, height: scroll.bounds.height / 2.5)
                scroll.zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height), animated: !UIAccessibility.isReduceMotionEnabled)
            }
        }
    }
}
