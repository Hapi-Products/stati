import Testing
@testable import StatiCore

struct FilePreviewTests {
    @Test func refusesExternalAndEscapedFileLinks() {
        for path in ["https://other.invalid/image.png", "//other.invalid/api/file", "/api/group-materials/../secret/file", "/api/group-materials/%2e%2e/file", "/api/group-materials/id/file?redirect=x", "/api/tasks"] {
            #expect(FilePreviewItem(record: APIRecord(raw: ["fileUrl": .string(path)]), pathKey: "fileUrl") == nil)
        }
    }
    @Test func galleryKeepsOrderAndSelectedImageWithoutDuplicateLinks() throws {
        let a = try #require(FilePreviewItem(record: APIRecord(raw: ["url": .string("/api/tasks/a/images/first"), "filename": .string("First.png")]), pathKey: "url"))
        let b = try #require(FilePreviewItem(record: APIRecord(raw: ["url": .string("/api/tasks/a/images/second"), "filename": .string("Second.png")]), pathKey: "url"))
        let request = try #require(FilePreviewRequest(items: [a, b, a], selectedID: b.id))
        #expect(request.items == [a, b]); #expect(request.selectedID == b.id)
        #expect(FilePreviewRequest(items: [a], selectedID: b.id) == nil)
    }
}
