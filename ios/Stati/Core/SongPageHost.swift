import SwiftUI
import PDFKit

struct SongPageHost: UIViewControllerRepresentable {
    let pages: [String]
    let document: PDFDocument?
    @Binding var index: Int
    let effect: ReaderTransition
    let clickerEnabled: Bool
    var slideSize: SlideTextSize = .large
    var allowsNavigation = true
    var count: Int { document?.pageCount ?? pages.count }
    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
    func makeUIViewController(context: Context) -> SongPageController {
        let controller = SongPageController(transitionStyle: effect == .pageTurn ? .pageCurl : .scroll, navigationOrientation: .horizontal, options: effect == .pageTurn ? [.spineLocation: UIPageViewController.SpineLocation.min.rawValue] : nil)
        controller.view.backgroundColor = document == nil ? .black : .systemBackground; controller.isDoubleSided = false; controller.delegate = context.coordinator
        context.coordinator.controller = controller; context.coordinator.configure()
        return controller
    }
    func updateUIViewController(_ controller: SongPageController, context: Context) { context.coordinator.parent = self; context.coordinator.configure() }
    static func dismantleUIViewController(_ controller: SongPageController, coordinator: Coordinator) { controller.navigate = nil; controller.keysEnabled = false; controller.dataSource = nil; controller.delegate = nil }
    @MainActor final class Coordinator: NSObject, UIPageViewControllerDataSource, UIPageViewControllerDelegate {
        var parent: SongPageHost
        weak var controller: SongPageController?
        private var children: [Int: UIViewController] = [:]
        private var transitioning = false
        private lazy var edgeTap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
        init(parent: SongPageHost) { self.parent = parent }
        func configure() {
            guard let controller else { return }
            controller.view.backgroundColor = parent.document == nil ? .black : .systemBackground
            controller.dataSource = parent.allowsNavigation && [.slide, .pageTurn].contains(parent.effect) ? self : nil
            controller.keysEnabled = parent.allowsNavigation && parent.clickerEnabled && UIDevice.current.userInterfaceIdiom == .pad
            controller.navigate = { [weak self] in self?.step($0) }
            if controller.keysEnabled && controller.view.window != nil { controller.becomeFirstResponder() }
            if edgeTap.view == nil { controller.view.addGestureRecognizer(edgeTap) }
            edgeTap.isEnabled = parent.allowsNavigation && parent.count > 1
            if controller.view.gestureRecognizers?.contains(where: { $0 is UISwipeGestureRecognizer }) != true {
                let left = UISwipeGestureRecognizer(target: self, action: #selector(swiped(_:))); left.direction = .left
                let right = UISwipeGestureRecognizer(target: self, action: #selector(swiped(_:))); right.direction = .right
                controller.view.addGestureRecognizer(left); controller.view.addGestureRecognizer(right)
            }
            for gesture in controller.view.gestureRecognizers ?? [] where gesture is UISwipeGestureRecognizer { gesture.isEnabled = parent.allowsNavigation && [.fade, .instant].contains(parent.effect) }
            showSelection()
        }
        private func page(_ index: Int) -> UIViewController? {
            guard (0..<parent.count).contains(index) else { return nil }
            if let cached = children[index] { return cached }
            let child: UIViewController
            if let document = parent.document { child = UIHostingController(rootView: SongPDFPage(document: document, index: index)) }
            else {
                let text = parent.pages[index]
                let ending = (text.components(separatedBy: "\n").last ?? "").trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters)).lowercased()
                child = UIHostingController(rootView: SongSlidePage(text: text, size: parent.slideSize, isEnding: index == parent.count - 1 && ["amen", "amin"].contains(ending)))
            }
            child.view.tag = index; child.view.backgroundColor = parent.document == nil ? .black : .systemBackground; children[index] = child
            return child
        }
        private func showSelection() {
            guard let controller, !transitioning, let next = page(parent.index) else { return }
            let current = controller.viewControllers?.first?.view.tag
            guard current != parent.index else { return }
            transitioning = true
            let direction: UIPageViewController.NavigationDirection = parent.index >= (current ?? 0) ? .forward : .reverse
            let finish: (Bool) -> Void = { [weak self] _ in
                guard let self else { return }; self.transitioning = false
                self.children = self.children.filter { abs($0.key - self.parent.index) < 3 }; self.showSelection()
            }
            if parent.effect == .fade && current != nil {
                UIView.transition(with: controller.view, duration: 0.2, options: [.transitionCrossDissolve, .allowAnimatedContent]) { controller.setViewControllers([next], direction: direction, animated: false) } completion: { finish($0) }
            } else { controller.setViewControllers([next], direction: direction, animated: parent.effect != .instant && current != nil, completion: finish) }
        }
        private func step(_ by: Int) { guard !transitioning, (0..<parent.count).contains(parent.index + by) else { return }; parent.index += by; showSelection() }
        @objc private func tapped(_ gesture: UITapGestureRecognizer) {
            guard let view = gesture.view, view.bounds.width > 0 else { return }
            let fraction = gesture.location(in: view).x / view.bounds.width
            if fraction < 1.0 / 3.0 { step(-1) }
            else if fraction > 2.0 / 3.0 { step(1) }
        }
        @objc private func swiped(_ gesture: UISwipeGestureRecognizer) { step(gesture.direction == .left ? 1 : -1) }
        func pageViewController(_ pageViewController: UIPageViewController, viewControllerBefore viewController: UIViewController) -> UIViewController? { page(viewController.view.tag - 1) }
        func pageViewController(_ pageViewController: UIPageViewController, viewControllerAfter viewController: UIViewController) -> UIViewController? { page(viewController.view.tag + 1) }
        func pageViewController(_ pageViewController: UIPageViewController, willTransitionTo pendingViewControllers: [UIViewController]) { transitioning = true }
        func pageViewController(_ pageViewController: UIPageViewController, didFinishAnimating finished: Bool, previousViewControllers: [UIViewController], transitionCompleted completed: Bool) {
            transitioning = false
            if completed, let selected = pageViewController.viewControllers?.first?.view.tag { parent.index = selected }
            showSelection()
        }
    }
}
