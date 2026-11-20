import Foundation
import Security

/// Where the server is and the key it wants. Addresses live in UserDefaults, the key in the Keychain.
struct AppSettings: Equatable, Sendable {
    var addresses: [String] = []
    var key: String = ""
    var preferred: String?

    var isConfigured: Bool { !routes.isEmpty && !key.isEmpty }

    /// Addresses to try, last one that worked first.
    var routes: [URL] {
        let urls = addresses.compactMap(Self.url)
        guard let preferred, let best = urls.first(where: { $0.absoluteString == preferred }) else { return urls }
        return [best] + urls.filter { $0 != best }
    }

    /// Accepts "192.168.4.21:8795" as well as a full http:// address.
    static func url(_ text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let full = trimmed.contains("://") ? trimmed : "http://\(trimmed)"
        guard let url = URL(string: full), let scheme = url.scheme, ["http", "https"].contains(scheme), url.host != nil else { return nil }
        return url
    }

    /// solarev://setup?key=...&url=...&url=... (node scripts/ios-link.js on the Mac makes this).
    static func parseSetupLink(_ text: String) -> AppSettings? {
        guard let parts = URLComponents(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              parts.scheme == "solarev", parts.host == "setup" else { return nil }
        let items = parts.queryItems ?? []
        var settings = AppSettings()
        settings.key = items.first { $0.name == "key" }?.value ?? ""
        settings.addresses = items.filter { $0.name == "url" }.compactMap(\.value).filter { url($0) != nil }
        return settings.isConfigured ? settings : nil
    }

    static func load() -> AppSettings {
        let defaults = UserDefaults.standard
        return AppSettings(
            addresses: defaults.stringArray(forKey: "addresses") ?? [],
            key: Keychain.read() ?? "",
            preferred: defaults.string(forKey: "preferredAddress")
        )
    }

    func save() {
        let defaults = UserDefaults.standard
        defaults.set(addresses, forKey: "addresses")
        defaults.set(preferred, forKey: "preferredAddress")
        Keychain.write(key)
    }
}

enum Keychain {
    private static var query: [CFString: Any] {
        [kSecClass: kSecClassGenericPassword, kSecAttrService: "solar-ev-app-key"]
    }

    static func read() -> String? {
        var search = query
        search[kSecReturnData] = true
        var item: CFTypeRef?
        guard SecItemCopyMatching(search as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ value: String) {
        SecItemDelete(query as CFDictionary)
        guard !value.isEmpty else { return }
        var add = query
        add[kSecValueData] = Data(value.utf8)
        // Readable after the first unlock, so a notification tap on a locked phone still loads the app. Stays on this phone.
        add[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }
}
