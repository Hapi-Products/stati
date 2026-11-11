import Foundation
import Testing
@testable import StatiCore
@Suite struct MultipleCorrectionsTests {
 private var source: String { "🎵 Har\nHar" }
 private func edit(_ location: Int, _ replacement: String = "Harul") -> SongCorrectionEdit { SongCorrectionEdit(id: UUID().uuidString.lowercased(), location: location, length: 3, quote: "Har", replacement: replacement) }
 private func draft() -> SongCorrectionDraft { SongCorrectionDraft(ownerID: UUID().uuidString, computerID: UUID().uuidString, song: APIRecord(raw: ["id": .string(String(repeating: "a", count: 64)), "text": .string(source), "contentHash": .string(String(repeating: "b", count: 64))])) }
 @Test func unicodeRangesKeepRepeatedWordsDistinct() { let a = edit(3), b = edit(7); #expect(a.valid(in: source)); #expect(b.valid(in: source)); #expect(a.range != b.range); #expect(!edit(1).valid(in: source)) }
 @Test func multipleEntriesFreezeAsOneExactReceipt() throws {
  var value = draft(); value.message = "Please check both"; value.edits = [edit(3), edit(7, "Pace")]; try value.freeze()
  #expect(value.payload["edits"].items.count == 2)
  var receipt = value.payload.fields; receipt["computerId"] = .string(value.computerID)
  #expect(value.accepts(.object(["correction": .object(receipt)])))
  receipt["edits"] = .array([value.edits[0].payload]); #expect(!value.accepts(.object(["correction": .object(receipt)])))
 }
 @Test func selectedLyricsCanBeSentWithoutASeparateComment() throws {
  var value = draft()
  value.edits = [edit(3, "Cântă și îți mulțumesc")]
  try value.freeze()
  #expect(value.payload["message"].text == "Review these selected lyrics.")
  #expect(value.payload["edits"].items.first?["replacement"].text == "Cântă și îți mulțumesc")
 }
 @Test func editableLegacyPassageMigratesWithoutChangingItsCorrection() {
  var value = draft(); value.quote = "Har"; value.replacement = "Harul"; value.migrateEditableSelection()
  #expect(value.edits.count == 1); #expect(value.edits.first?.location == 3); #expect(value.edits.first?.replacement == "Harul"); #expect(value.quote.isEmpty); #expect(value.replacement.isEmpty)
 }
 @Test func oldSavedDraftStillDecodes() throws {
  let original = draft(); var json = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as? [String: Any]); json.removeValue(forKey: "edits")
  let restored = try JSONDecoder().decode(SongCorrectionDraft.self, from: JSONSerialization.data(withJSONObject: json)); #expect(restored.id == original.id); #expect(restored.edits.isEmpty)
 }
 @Test func oldFrozenPayloadNeverChangesWhenEntriesAreAdded() throws {
  var value = draft(); value.message = "Old request"; value.quote = "Har"; try value.freeze(); let frozen = value.payload
  value.edits = [edit(7)]; try value.freeze(); #expect(value.payload == frozen)
 }
 @Test func combinedReviewTextMustStayEditableByTheOperator() {
  var value = draft(); value.message = String(repeating: "M", count: 2000); value.edits = (0..<3).map { _ in edit(3, String(repeating: "X", count: 1000)) }
  #expect(throws: (any Error).self) { try value.freeze() }
 }
 @Test func invalidSourcePassagesCannotFreeze() {
  var value = draft(); value.message = "Wrong word"; value.edits = [edit(1)]
  #expect(throws: (any Error).self) { try value.freeze() }
 }
}
