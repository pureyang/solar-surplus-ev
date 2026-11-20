import UserNotifications
#if os(iOS)
import UIKit
#endif

enum PushStatus: Equatable, Sendable {
    case unknown
    case allowed
    case deniedInSettings
    /// Built without the push entitlement (SOLAREV_PUSH = NO), as a free Apple ID requires.
    case notInThisBuild
}

@MainActor
enum Push {
    static var deviceToken: String?
    static var registrationError: String?

    /// SOLAREV_PUSH in the Xcode project, copied into Info.plist. Pushes need a paid Apple Developer membership.
    static let inThisBuild = Bundle.main.object(forInfoDictionaryKey: "SolarEVPush") as? String == "YES"

    /// Xcode builds get tokens for Apple's sandbox server, TestFlight builds for production. The server also
    /// corrects this on its own if it's wrong.
    static var environment: String {
        #if DEBUG
        "sandbox"
        #else
        "production"
        #endif
    }

    static var deviceName: String {
        #if os(iOS)
        UIDevice.current.name
        #else
        "Mac"
        #endif
    }

    /// Asks once; afterwards this returns the current answer without a prompt. iOS tokens can change, so it
    /// registers on every launch.
    static func requestAndRegister() async -> PushStatus {
        // Without the entitlement iOS can't hand out a token, so don't ask for a permission that does nothing.
        guard inThisBuild else { return .notInThisBuild }
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
        guard granted else { return .deniedInSettings }
        #if os(iOS)
        UIApplication.shared.registerForRemoteNotifications()
        #endif
        return .allowed
    }
}

#if os(iOS)
final class PushDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Push.deviceToken = deviceToken.map { String(format: "%02x", $0) }.joined()
        Push.registrationError = nil
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Push.registrationError = error.localizedDescription
    }

    /// Show the banner even with the app open.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
}
#endif
