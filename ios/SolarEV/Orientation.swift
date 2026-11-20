import SwiftUI

/// The app is portrait, except the full-screen chart, which turns landscape while it's open.
/// PushDelegate (the app delegate) answers iOS with `mask`.
enum OrientationLock {
    nonisolated(unsafe) static var mask: UIInterfaceOrientationMask = .portrait

    @MainActor
    static func set(_ new: UIInterfaceOrientationMask) {
        mask = new
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }
        var controller = scene.keyWindow?.rootViewController
        while let current = controller {
            current.setNeedsUpdateOfSupportedInterfaceOrientations()
            controller = current.presentedViewController
        }
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: new)) { _ in }
    }
}
