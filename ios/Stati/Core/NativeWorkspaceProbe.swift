#if DEBUG && targetEnvironment(simulator)
import Foundation
@MainActor final class NativeWorkspaceProbe { var downloads = 0; var block = false }
#endif
