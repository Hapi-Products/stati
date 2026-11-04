#if DEBUG && targetEnvironment(simulator)
import Foundation
@MainActor enum NativeCommenterReview {
    static var composerSong: JSONValue {
        var song = NativeReview.song.fields
        song["text"] = .string(NativeReview.song["text"].text + "\n\nThrough many dangers, toils and snares\nI have already come\n’Tis grace hath brought me safe thus far\nAnd grace will lead me home")
        return .object(song)
    }
    static let commentID = "bafe63b6-80e4-448a-a3ec-1cb61a129142"
    static var comment: JSONValue { .object([
        "id": .string(commentID), "computerId": .string(NativeReview.computerID), "songId": .string(NativeReview.songID),
        "contentHash": NativeReview.song["contentHash"], "title": .string("Amazing Grace"),
        "message": .string("Please check the second line before Sunday."), "quote": .string("That saved a wretch like me"),
        "replacement": .string("That saved a wretch like me"), "status": .string("in-progress")
    ]) }
    static func response(_ request: URLRequest) -> JSONValue? {
        guard NativeReview.route?.hasPrefix("commenter-") == true else { return nil }
        let path = request.url?.path ?? ""
        if path.hasSuffix("/songs/" + NativeReview.songID), ["commenter-compose", "commenter-corrections", "commenter-selection"].contains(NativeReview.route ?? "") { return composerSong }
        if path.hasSuffix("/song-comments") { return .object(["items": .array([comment]), "service": NativeReview.plan]) }
        if path == "/api/song-comments/" + commentID { return .object(["correction": comment, "notes": .array([])]) }
        if path == "/api/tasks/" + commentID + "/images" { return .object(["images": .array([])]) }
        return nil
    }
}
#endif
