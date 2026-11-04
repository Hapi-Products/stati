import SwiftUI
import UIKit

struct ReaderKeyboard: UIViewControllerRepresentable {
    var enabled = true
    let navigate: (Int) -> Void
    func makeUIViewController(context: Context) -> ReaderKeyboardController { let view = ReaderKeyboardController(); view.navigate = enabled ? navigate : nil; return view }
    func updateUIViewController(_ controller: ReaderKeyboardController, context: Context) { controller.navigate = enabled ? navigate : nil }
}
final class ReaderKeyboardController: UIViewController {
    var navigate: ((Int) -> Void)?
    override var canBecomeFirstResponder: Bool { true }
    override var keyCommands: [UIKeyCommand]? { UIDevice.current.userInterfaceIdiom != .pad || navigate == nil ? nil : ReaderKeyBindings.commands(action: #selector(readingKey(_:))) }
    override func loadView() { view = UIView(); view.backgroundColor = .clear; view.isUserInteractionEnabled = false }
    override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated); becomeFirstResponder() }
    @objc private func readingKey(_ command: UIKeyCommand) { if UIDevice.current.userInterfaceIdiom == .pad, let step = ReaderKeyBindings.step(for: command.input) { navigate?(step) } }
}
