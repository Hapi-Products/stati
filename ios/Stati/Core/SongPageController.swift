import UIKit
@MainActor final class SongPageController: UIPageViewController {
    var navigate: ((Int) -> Void)?
    var keysEnabled = false
    override var canBecomeFirstResponder: Bool { keysEnabled }
    override var keyCommands: [UIKeyCommand]? { keysEnabled && UIDevice.current.userInterfaceIdiom == .pad ? ReaderKeyBindings.commands(action: #selector(keyPressed(_:))) : [] }
    @objc private func keyPressed(_ command: UIKeyCommand) {
        guard keysEnabled, UIDevice.current.userInterfaceIdiom == .pad, let step = ReaderKeyBindings.step(for: command.input) else { return }
        navigate?(step)
    }
}
