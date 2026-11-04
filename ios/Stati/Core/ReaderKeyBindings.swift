import UIKit

@MainActor enum ReaderKeyBindings {
    static let forward = [UIKeyCommand.inputRightArrow, UIKeyCommand.inputDownArrow, UIKeyCommand.inputPageDown, " "]
    static let backward = [UIKeyCommand.inputLeftArrow, UIKeyCommand.inputUpArrow, UIKeyCommand.inputPageUp, "\u{8}"]
    static func step(for input: String?) -> Int? {
        guard let input else { return nil }
        return forward.contains(input) ? 1 : backward.contains(input) ? -1 : nil
    }
    static func commands(action: Selector) -> [UIKeyCommand] {
        (forward + backward).map { input in
            let command = UIKeyCommand(title: forward.contains(input) ? "Next item" : "Previous item", action: action, input: input)
            command.wantsPriorityOverSystemBehavior = true
            return command
        }
    }
}
