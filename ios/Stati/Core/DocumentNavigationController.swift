import UIKit

final class DocumentNavigationController: UINavigationController {
    var navigate: ((Int) -> Void)?
    override var keyCommands: [UIKeyCommand]? { UIDevice.current.userInterfaceIdiom != .pad || navigate == nil || presentedViewController != nil || visibleViewController?.presentedViewController != nil ? super.keyCommands : ReaderKeyBindings.commands(action: #selector(readingKey(_:))) }
    @objc private func readingKey(_ command: UIKeyCommand) { if UIDevice.current.userInterfaceIdiom == .pad, let step = ReaderKeyBindings.step(for: command.input) { navigate?(step) } }
    override func present(_ controller: UIViewController, animated: Bool, completion: (() -> Void)? = nil) {
        SharePopoverPlacement.configure(controller, traits: traitCollection)
        super.present(controller, animated: animated, completion: completion)
    }
}
