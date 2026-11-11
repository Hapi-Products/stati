import SwiftUI
import UIKit

struct SongCorrectionLyrics: UIViewRepresentable {
    let text: String
    var initialSelection: NSRange? = nil
    let selected: (NSRange) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
    static func makeTextView(text: String) -> UITextView {
        let view = SongCorrectionTextView(); view.isEditable = false; view.isSelectable = true; view.isScrollEnabled = false; view.backgroundColor = .clear
        view.font = .preferredFont(forTextStyle: .body); view.adjustsFontForContentSizeCategory = true
        view.textContainerInset = UIEdgeInsets(top: 12, left: 8, bottom: 12, right: 8); view.text = text
        view.accessibilityLabel = "Song lyrics. Double-tap a word to select it."
        return view
    }
    func makeUIView(context: Context) -> UITextView { let view = Self.makeTextView(text: text); view.delegate = context.coordinator; return view }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        return uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    }
    func updateUIView(_ view: UITextView, context: Context) {
        let coordinator = context.coordinator; coordinator.parent = self
        coordinator.applying = true; defer { coordinator.applying = false }
        if view.text != text { view.text = text }
        if let initialSelection, coordinator.appliedSelection != initialSelection {
            coordinator.appliedSelection = initialSelection
            if Range(initialSelection, in: text) != nil { view.selectedRange = initialSelection; (view as? SongCorrectionTextView)?.prepareInitialSelection(initialSelection) }
        }
    }
    static func dismantleUIView(_ view: UITextView, coordinator: Coordinator) { coordinator.pending?.cancel(); view.delegate = nil }
    @MainActor final class Coordinator: NSObject, UITextViewDelegate {
        var parent: SongCorrectionLyrics
        var applying = false
        var appliedSelection: NSRange?
        var pending: Task<Void, Never>?
        init(parent: SongCorrectionLyrics) { self.parent = parent }
        func textViewDidChangeSelection(_ textView: UITextView) {
            guard !applying else { return }; pending?.cancel()
            let range = textView.selectedRange
            guard range.location != NSNotFound, range.length > 0, Range(range, in: parent.text) != nil else { return }
            pending = Task { @MainActor [weak self, weak textView] in
                do { try await Task.sleep(for: .milliseconds(180)) } catch { return }
                guard let self, let textView, textView.selectedRange == range else { return }
                self.parent.selected(range)
            }
        }
    }
}
