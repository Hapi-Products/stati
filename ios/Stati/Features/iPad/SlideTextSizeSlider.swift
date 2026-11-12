import SwiftUI
import UIKit

struct SlideTextSizeSlider: UIViewRepresentable {
    let size: SlideTextSize
    let save: (SlideTextSize) -> Void

    func makeUIView(context: Context) -> TrackSlider {
        let slider = TrackSlider()
        slider.minimumValue = 0
        slider.maximumValue = 3
        slider.accessibilityLabel = "Slide text size"
        slider.onCommit = save
        slider.installGestures()
        return slider
    }

    func updateUIView(_ slider: TrackSlider, context: Context) {
        slider.onCommit = save
        slider.minimumTrackTintColor = UIColor(AppIconAppearance.shared.accent)
        if !slider.isDragging, slider.value != Float(size.sliderPosition) {
            slider.value = Float(size.sliderPosition)
        }
    }

    final class TrackSlider: UISlider, UIGestureRecognizerDelegate {
        var onCommit: ((SlideTextSize) -> Void)?
        private lazy var pan = UIPanGestureRecognizer(target: self, action: #selector(dragged(_:)))
        private var startingValue: Float = 0
        var isDragging: Bool { pan.state == .began || pan.state == .changed }

        func installGestures() {
            pan.delegate = self
            let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
            tap.require(toFail: pan)
            addGestureRecognizer(pan)
            addGestureRecognizer(tap)
        }

        override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard gestureRecognizer === pan else { return super.gestureRecognizerShouldBegin(gestureRecognizer) }
            let velocity = pan.velocity(in: self)
            return abs(velocity.x) > abs(velocity.y)
        }

        override var accessibilityValue: String? {
            get {
                guard let size = SlideTextSize(sliderPosition: Double(value)) else { return nil }
                return "\(Int(size.points.rounded())) points"
            }
            set { super.accessibilityValue = newValue }
        }

        override func beginTracking(_ touch: UITouch, with event: UIEvent?) -> Bool {
            // The same coordinate mapping handles presses and drags anywhere on the track.
            false
        }

        override func accessibilityIncrement() {
            value = min(maximumValue, value + 0.2)
            commit()
        }

        override func accessibilityDecrement() {
            value = max(minimumValue, value - 0.2)
            commit()
        }

        @objc private func dragged(_ gesture: UIPanGestureRecognizer) {
            switch gesture.state {
            case .began:
                startingValue = value
                updateValue(at: gesture.location(in: self))
            case .changed:
                updateValue(at: gesture.location(in: self))
            case .ended:
                updateValue(at: gesture.location(in: self))
                commit()
            case .cancelled:
                value = startingValue
            default:
                break
            }
        }

        @objc private func tapped(_ gesture: UITapGestureRecognizer) {
            updateValue(at: gesture.location(in: self))
            commit()
        }

        private func updateValue(at location: CGPoint) {
            let track = trackRect(forBounds: bounds)
            let minimumX = thumbRect(forBounds: bounds, trackRect: track, value: minimumValue).midX
            let maximumX = thumbRect(forBounds: bounds, trackRect: track, value: maximumValue).midX
            guard maximumX != minimumX else { return }
            let position = min(1, max(0, (location.x - minimumX) / (maximumX - minimumX)))
            value = minimumValue + Float(position) * (maximumValue - minimumValue)
        }

        private func commit() {
            if let size = SlideTextSize(sliderPosition: Double(value)) { onCommit?(size) }
        }
    }
}
