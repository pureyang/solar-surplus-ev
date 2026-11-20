import SwiftUI

@main
struct SolarEVApp: App {
    #if os(iOS)
    @UIApplicationDelegateAdaptor(PushDelegate.self) private var pushDelegate
    #endif
    // Created before the first frame: this is what puts the last known numbers on screen right away.
    @State private var store = Store()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView(store: store)
                .tint(.primary) // neutral on purpose: blue and orange are reserved for good and bad
                .onOpenURL { store.applySetupLink($0) }
                .task(id: "\(scenePhase == .active) \(store.settings.isConfigured)") {
                    guard scenePhase == .active else {
                        store.saveCache()
                        return
                    }
                    await store.setUpPush()
                    await store.runWhileActive()
                }
        }
    }
}

struct RootView: View {
    let store: Store

    var body: some View {
        if store.settings.isConfigured {
            StatusView(store: store)
        } else {
            NavigationStack {
                SettingsView(store: store, isFirstRun: true)
            }
        }
    }
}
