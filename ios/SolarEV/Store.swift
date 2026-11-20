import Foundation
import Observation

/// App state. The last reading is loaded from disk in init, before the first frame, and marked with its real
/// age. Fresh data replaces it as soon as any address answers.
@MainActor
@Observable
final class Store {
    enum Problem: Equatable, Sendable {
        case unreachable
        case badKey
    }

    /// Fast enough to feel live; the request is about a kilobyte over a connection that stays open.
    private static let pollEvery: Duration = .seconds(3)
    private static let saveEvery: TimeInterval = 15

    private(set) var settings: AppSettings
    private(set) var snapshot: Snapshot?
    private(set) var fetchedAt: Date?
    private(set) var route: URL?
    private(set) var problem: Problem?
    private(set) var push = PushStatus.unknown

    @ObservationIgnored private let client = HomeClient()
    @ObservationIgnored private let cache: SnapshotCache
    @ObservationIgnored private var savedAt = Date.distantPast
    @ObservationIgnored private var postedToken: String?

    init(settings: AppSettings = .load(), cache: SnapshotCache = SnapshotCache()) {
        self.settings = settings
        self.cache = cache
        if let saved = cache.load() {
            snapshot = saved.snapshot
            fetchedAt = saved.fetchedAt
        }
    }

    func runWhileActive() async {
        while settings.isConfigured && !Task.isCancelled {
            await refresh()
            try? await Task.sleep(for: Self.pollEvery)
        }
    }

    func refresh() async {
        guard settings.isConfigured else { return }
        switch await client.firstAnswer(bases: settings.routes, key: settings.key) {
        case let .ok(fresh, base):
            // Two overlapping refreshes (pull to refresh during a poll) can finish out of order.
            if let current = snapshot, fresh.at < current.at, route != nil { return }
            snapshot = fresh
            fetchedAt = .now
            problem = nil
            noteRoute(base)
            if Date.now.timeIntervalSince(savedAt) > Self.saveEvery { saveCache() }
            await postPushToken()
        case .badKey:
            problem = .badKey
        case .failed:
            problem = .unreachable
            route = nil
        }
    }

    private func noteRoute(_ base: URL) {
        route = base
        if settings.preferred != base.absoluteString {
            settings.preferred = base.absoluteString
            UserDefaults.standard.set(settings.preferred, forKey: "preferredAddress")
        }
    }

    /// One period for the graphs, nil if no address answered. Starts with the address the live reading uses.
    func loadPeriod(span: String, day: String) async -> DayData? {
        guard settings.isConfigured else { return nil }
        let bases = (route.map { [$0] } ?? []) + settings.routes.filter { $0 != route }
        return await client.fetchPeriod(bases: bases, key: settings.key, span: span, day: day)
    }

    func saveCache() {
        guard let snapshot, let fetchedAt else { return }
        cache.save(.init(snapshot: snapshot, fetchedAt: fetchedAt))
        savedAt = .now
    }

    // MARK: Settings

    func apply(_ new: AppSettings) {
        settings = new
        settings.save()
        problem = nil
        route = nil
    }

    /// Returns false if the text isn't a setup link.
    @discardableResult
    func applySetupLink(_ text: String) -> Bool {
        guard let parsed = AppSettings.parseSetupLink(text) else { return false }
        apply(parsed)
        return true
    }

    func applySetupLink(_ url: URL) {
        applySetupLink(url.absoluteString)
    }

    // MARK: Notifications

    func setUpPush() async {
        guard settings.isConfigured else { return }
        push = await Push.requestAndRegister()
    }

    /// iOS hands over the token some time after launch, and the server may be out of reach at that moment,
    /// so this runs after every good read until it has gone through.
    private func postPushToken() async {
        guard let token = Push.deviceToken, token != postedToken, let route else { return }
        let ok = await client.registerDevice(base: route, key: settings.key, token: token, env: Push.environment, name: Push.deviceName)
        if ok { postedToken = token }
    }

    func sendTestPush() async -> String {
        guard let route else { return "Can't reach home right now" }
        guard let result = await client.sendTestPush(base: route, key: settings.key) else { return "The server didn't answer" }
        return result.ok ? "Sent. It should arrive in a few seconds." : (result.error ?? "It didn't send")
    }
}

/// The last reading on disk, so the next launch has real numbers on its first frame.
struct SnapshotCache: Sendable {
    struct Saved: Codable, Sendable {
        var snapshot: Snapshot
        var fetchedAt: Date
    }

    var file: URL = URL.applicationSupportDirectory.appending(path: "last-reading.json")

    func load() -> Saved? {
        guard let data = try? Data(contentsOf: file) else { return nil }
        return try? JSONDecoder().decode(Saved.self, from: data)
    }

    func save(_ saved: Saved) {
        guard let data = try? JSONEncoder().encode(saved) else { return }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: file, options: .atomic)
    }
}
