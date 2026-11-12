import FoundationModels
import UIKit

enum SiriPreviewAvailability {
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
