import SwiftUI
import UIKit

struct RomanianCorrectionField: View {
    @Binding var text: String
    let editable: Bool
    var body: some View {
        RomanianCorrectionInput(text: $text, editable: editable)
            .overlay(alignment: .topLeading) {
                if text.isEmpty && editable {
                    Text("Suggested correction").foregroundStyle(.tertiary)
                        .padding(.top, 8).allowsHitTesting(false).accessibilityHidden(true)
                }
            }
    }
}

private struct RomanianCorrectionInput: UIViewRepresentable {
    @Binding var text: String
    let editable: Bool

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.backgroundColor = .clear
        view.font = .preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.textContainerInset = UIEdgeInsets(top: 8, left: 0, bottom: 8, right: 0)
        view.textContainer.lineFragmentPadding = 0
        view.accessibilityLabel = "Suggested correction"
        view.delegate = context.coordinator
        view.inputAccessoryView = accentBar(for: view)
        #if DEBUG && targetEnvironment(simulator)
        if NativeReview.route == "commenter-corrections", !text.isEmpty {
            Task { @MainActor [weak view] in
                try? await Task.sleep(for: .seconds(2))
                _ = view?.becomeFirstResponder()
            }
        }
        #endif
        return view
    }

    private func accentBar(for textView: UITextView) -> UIInputView {
        let bar = UIInputView(frame: CGRect(x: 0, y: 0, width: 0, height: 44), inputViewStyle: .keyboard)
        bar.autoresizingMask = [.flexibleWidth]
        let row = UIStackView()
        row.axis = .horizontal
        row.distribution = .fillEqually
        row.spacing = 4
        row.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(row)
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 12),
            row.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -12),
            row.topAnchor.constraint(equalTo: bar.topAnchor),
            row.bottomAnchor.constraint(equalTo: bar.bottomAnchor)
        ])

        let accents = "ăâîșț".map { character in
            let button = UIButton(type: .system)
            button.setTitle(String(character), for: .normal)
            button.titleLabel?.font = .preferredFont(forTextStyle: .body)
            button.addAction(UIAction { [weak textView, weak button] _ in
                if let title = button?.currentTitle { textView?.insertText(title) }
            }, for: .primaryActionTriggered)
            row.addArrangedSubview(button)
            return button
        }
        let shift = UIButton(type: .system)
        shift.setImage(UIImage(systemName: "shift"), for: .normal)
        shift.setImage(UIImage(systemName: "shift.fill"), for: .selected)
        shift.accessibilityLabel = "Uppercase Romanian letters"
        shift.addAction(UIAction { [weak shift] _ in
            guard let shift else { return }
            shift.isSelected.toggle()
            for (button, letter) in zip(accents, "ăâîșț") {
                let lower = String(letter)
                button.setTitle(shift.isSelected ? lower.uppercased() : lower, for: .normal)
            }
        }, for: .primaryActionTriggered)
        row.addArrangedSubview(shift)
        return bar
    }

    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.parent = self
        view.isEditable = editable
        if view.text != text { view.text = text }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        let size = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: min(180, max(44, size.height)))
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: RomanianCorrectionInput
        init(_ parent: RomanianCorrectionInput) { self.parent = parent }
        func textViewDidChange(_ textView: UITextView) { parent.text = textView.text }
    }
}
