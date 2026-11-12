import FoundationModels
import UIKit

enum SiriPreviewAvailability: String {
    case ready, olderSystem, unsupportedDevice, intelligenceOff, preparing, unavailable

    static var current: Self {
        guard #available(iOS 27.3, *) else { return .olderSystem }
        switch SystemLanguageModel.default.availability {
        case .available: return .ready
        case .unavailable(.deviceNotEligible): return .unsupportedDevice
        case .unavailable(.appleIntelligenceNotEnabled): return .intelligenceOff
        case .unavailable(.modelNotReady): return .preparing
        default: return .unavailable
        }
    }

    var detail: String {
        switch self {
        case .ready: "Device requirements met. Siri AI preview setup is managed in Apple Settings."
        case .olderSystem: "Requires \(UIDevice.current.userInterfaceIdiom == .pad ? "iPadOS" : "iOS") 27.3 or later."
        case .unsupportedDevice: "Apple Intelligence is unavailable on this device."
        case .intelligenceOff: "Apple Intelligence is turned off."
        case .preparing: "Apple Intelligence is preparing its models."
        case .unavailable: "Apple Intelligence availability could not be confirmed."
        }
    }
}


@MainActor
enum StatiDeveloperMode {
    nonisolated static let key = "stati.developerMode"

    nonisolated static var isBeta: Bool {
        #if STATI_BETA || DEBUG
        true
        #else
        false
        #endif
    }

    static var isSupported: Bool {
        guard isBeta else { return false }
        if #available(iOS 27.3, *) { return true }
        return false
    }

    static var allowsShortcuts: Bool {
        #if DEBUG && targetEnvironment(simulator)
        if NativeReview.route == "reader-place-song" { return true }
        #endif
        if isBeta { return isSupported && UserDefaults.standard.bool(forKey: key) }
        return UserDefaults.standard.object(forKey: "stati.shortcuts.enabled") as? Bool ?? true
    }
}
