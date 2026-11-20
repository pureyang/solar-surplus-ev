import SwiftUI

struct SettingsView: View {
    let store: Store
    let isFirstRun: Bool

    @Environment(\.dismiss) private var dismiss
    @State private var addresses: [String]
    @State private var key: String
    @State private var pasteProblem: String?
    @State private var testResult: String?
    @State private var testing = false

    private static let addressRows = 3

    init(store: Store, isFirstRun: Bool) {
        self.store = store
        self.isFirstRun = isFirstRun
        var rows = store.settings.addresses
        while rows.count < Self.addressRows { rows.append("") }
        _addresses = State(initialValue: rows)
        _key = State(initialValue: store.settings.key)
    }

    private var draft: AppSettings {
        AppSettings(
            addresses: addresses.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { AppSettings.url($0) != nil },
            key: key.trimmingCharacters(in: .whitespacesAndNewlines),
            preferred: store.settings.preferred
        )
    }

    var body: some View {
        Form {
            Section {
                PasteButton(payloadType: String.self) { strings in
                    let link = strings.first ?? ""
                    Task { @MainActor in
                        if store.applySetupLink(link) {
                            pasteProblem = nil
                            if !isFirstRun { dismiss() }
                        } else {
                            pasteProblem = "That isn't a setup link."
                        }
                    }
                }
                if let pasteProblem {
                    BadgeView(badge: Badge(tone: .bad, text: pasteProblem))
                }
            } header: {
                Text("Setup link")
            } footer: {
                Text("On the Mac, run `node scripts/ios-link.js` in the project folder. That copies the link, then tap Paste here.")
            }

            Section {
                ForEach(addresses.indices, id: \.self) { i in
                    TextField(i == 0 ? "192.168.1.20:8787" : "Another address (optional)", text: $addresses[i])
                        .addressField()
                }
                SecureField("APP_KEY from .env", text: $key)
                Button("Save") {
                    store.apply(draft)
                    if !isFirstRun { dismiss() }
                }
                .disabled(!draft.isConfigured)
            } header: {
                Text("Or enter by hand")
            } footer: {
                Text("Add your home address and your Tailscale address. The app uses whichever answers first.")
            }

            if !isFirstRun {
                notifications
            }
        }
        .navigationTitle(isFirstRun ? "Connect to home" : "Settings")
        .toolbar {
            if !isFirstRun {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    @ViewBuilder
    private var notifications: some View {
        if store.push == .notInThisBuild {
            Section {
                BadgeView(badge: Badge(tone: .neutral, text: "Sent to the ntfy app"))
            } header: {
                Text("Charging notifications")
            } footer: {
                Text("Alerts in this app need a paid Apple Developer membership. Until then, the server sends them to ntfy.")
            }
        } else {
            pushSection
        }
    }

    private var pushSection: some View {
        Section("Charging notifications") {
            BadgeView(badge: pushBadge)
            Button(testing ? "Sending…" : "Send a test notification") {
                testing = true
                Task { @MainActor in
                    testResult = await store.sendTestPush()
                    testing = false
                }
            }
            .disabled(testing)
            if let testResult {
                Text(testResult).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    private var pushBadge: Badge {
        if store.push == .deniedInSettings { return Badge(tone: .bad, text: "Turned off in iOS Settings") }
        if let error = Push.registrationError { return Badge(tone: .bad, text: "iOS couldn't register: \(error)") }
        guard let info = store.snapshot?.push else { return Badge(tone: .neutral, text: "Waiting for the server") }
        if !info.configured { return Badge(tone: .middle, text: "The server has no Apple push key yet") }
        return info.devices > 0
            ? Badge(tone: .good, text: "On")
            : Badge(tone: .middle, text: "This phone hasn't registered yet")
    }
}

private extension View {
    @ViewBuilder
    func addressField() -> some View {
        #if os(iOS)
        self
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        #else
        self
        #endif
    }
}
