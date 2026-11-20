import Foundation

/// A stated connection. The symbol and words carry the meaning; colour only repeats it.
struct Badge: Equatable, Sendable {
    enum Tone: Equatable, Sendable { case good, middle, bad, neutral }

    var tone: Tone
    var text: String

    var symbol: String {
        switch tone {
        case .good: "✓"
        case .middle: "≈"
        case .bad: "✗"
        case .neutral: "·"
        }
    }
}

enum Format {
    static func ago(_ seconds: Double) -> String {
        let s = max(0, seconds)
        if s < 90 { return "\(Int(s)) s ago" }
        if s < 5400 { return "\(Int((s / 60).rounded())) min ago" }
        if s < 129_600 { return "\(Int((s / 3600).rounded())) h ago" }
        return "\(Int((s / 86_400).rounded())) d ago"
    }

    /// "5:55 PM" today, "Oct 31, 5:55 PM" on any other day.
    static func when(_ ts: Double, serverNow: Double) -> String {
        let date = Date(timeIntervalSince1970: ts)
        let today = Calendar.current.isDate(date, inSameDayAs: Date(timeIntervalSince1970: serverNow))
        return today
            ? date.formatted(.dateTime.hour().minute())
            : date.formatted(.dateTime.month(.abbreviated).day().hour().minute())
    }

    static func kW(_ watts: Double) -> String { String(format: "%.1f kW", abs(watts) / 1000) }
    static func whole(_ value: Double) -> String { String(Int(value.rounded())) }
}

/// Everything the status screen says, worked out in one place with no SwiftUI.
struct StatusModel: Equatable, Sendable {
    struct HomeCard: Equatable, Sendable {
        var soc: Double?
        var activity: String?
        var badge: Badge
        var detail: String?
        var dim: Bool
    }

    struct CarCard: Equatable, Sendable, Identifiable {
        var id: String
        var name: String
        var soc: Double?
        var limit: Double?
        var socNote: String
        var isCharging: Bool
        var activity: String
        var badge: Badge
        var detail: String?
        var dim: Bool
    }

    /// Older than this and the phone has lost touch with home: nothing is presented as current any more.
    static let staleAfter: TimeInterval = 20

    var header: Badge
    var home: HomeCard?
    var cars: [CarCard]
    var bridge: Badge?

    init(snapshot: Snapshot?, fetchedAt: Date?, route: URL?, problem: Store.Problem?, now: Date) {
        guard let snapshot, let fetchedAt else {
            header = Self.emptyHeader(problem)
            home = nil
            cars = []
            bridge = nil
            return
        }
        let age = max(0, now.timeIntervalSince(fetchedAt))
        let clock = Clock(serverNow: snapshot.at + age, stale: age > Self.staleAfter, asOf: snapshot.at)
        header = Self.header(problem: problem, route: route, age: age, clock: clock)
        home = Self.homeCard(snapshot.home, clock)
        cars = snapshot.cars.map { Self.carCard($0, clock) }
        bridge = Self.bridgeBadge(snapshot, clock)
    }

    private struct Clock {
        let serverNow: Double
        let stale: Bool
        let asOf: Double
        var asOfText: String { Format.when(asOf, serverNow: serverNow) }
    }

    private static func emptyHeader(_ problem: Store.Problem?) -> Badge {
        switch problem {
        case .badKey: Badge(tone: .bad, text: "The server rejected the key")
        case .unreachable: Badge(tone: .bad, text: "Can't reach home")
        case nil: Badge(tone: .neutral, text: "Connecting…")
        }
    }

    private static func header(problem: Store.Problem?, route: URL?, age: TimeInterval, clock: Clock) -> Badge {
        if problem == .badKey { return Badge(tone: .bad, text: "The server rejected the key. Showing data from \(clock.asOfText)") }
        if problem == .unreachable || clock.stale { return Badge(tone: .middle, text: "Can't reach home. Showing data from \(clock.asOfText)") }
        guard let route else { return Badge(tone: .neutral, text: "Updating…") }
        return Badge(tone: .good, text: "\(routeName(route)), updated \(Format.ago(age))")
    }

    static func routeName(_ url: URL) -> String {
        let parts = (url.host ?? "").split(separator: ".").compactMap { Int($0) }
        let isTailscale = parts.count == 4 && parts[0] == 100 && (64...127).contains(parts[1])
        return isTailscale ? "Tailscale" : "Home network"
    }

    private static func homeCard(_ h: Snapshot.Home, _ clock: Clock) -> HomeCard {
        let when = h.ts.map { Format.when($0, serverNow: clock.serverNow) }
        let badge: Badge
        var detail: String?
        if clock.stale {
            badge = Badge(tone: .middle, text: "Gateway state from \(clock.asOfText)")
        } else {
            switch h.link {
            case "local":
                badge = Badge(tone: .good, text: "Gateway connected")
                detail = h.ts.map { "Reading \(Format.ago(clock.serverNow - $0))" }
            case "cloud":
                badge = Badge(tone: .middle, text: "Gateway not answering, using Enlighten cloud")
                detail = h.ts.map { "Reading \(Format.ago(clock.serverNow - $0))" }
            default:
                badge = Badge(tone: .bad, text: when.map { "No gateway data since \($0)" } ?? "No gateway data")
            }
        }
        return HomeCard(
            soc: h.soc,
            activity: clock.stale || h.link == "none" ? nil : homeActivity(h),
            badge: badge,
            detail: detail,
            dim: clock.stale || h.link == "none"
        )
    }

    private static func homeActivity(_ h: Snapshot.Home) -> String? {
        var parts: [String] = []
        if let b = h.battW {
            parts.append(b < -50 ? "Charging \(Format.kW(b))" : b > 50 ? "Discharging \(Format.kW(b))" : "Idle")
        }
        if let pv = h.pvW { parts.append("Solar \(Format.kW(pv))") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private static func carCard(_ c: Snapshot.Car, _ clock: Clock) -> CarCard {
        let linked = c.link == "linked"
        let live = linked && !clock.stale
        var socNote = "No real reading yet"
        if c.soc != nil, let ts = c.socTs {
            let age = clock.serverNow - ts
            socNote = live && age <= 60 ? "Live" : "Last real reading \(Format.when(ts, serverNow: clock.serverNow)), \(Format.ago(age))"
        }
        var activity = linked ? chargeText(c) : "Charging state unknown with no link"
        if linked && clock.stale { activity = "At \(clock.asOfText): \(activity)" }

        return CarCard(
            id: c.key,
            name: c.name,
            soc: c.soc,
            limit: c.limit,
            socNote: socNote,
            isCharging: live && c.charging == true,
            activity: activity,
            badge: carBadge(c, clock),
            detail: carDetail(c, clock),
            dim: !live
        )
    }

    private static func carBadge(_ c: Snapshot.Car, _ clock: Clock) -> Badge {
        if clock.stale {
            let state = c.link == "linked" ? "Linked" : "No Bluetooth link"
            return Badge(tone: .middle, text: "\(state) at \(clock.asOfText)")
        }
        switch c.link {
        case "linked":
            let signal = c.rssi.map { ", \(Int($0)) dBm" } ?? ""
            return Badge(tone: .good, text: "Bluetooth linked\(signal)")
        case "pairing":
            return Badge(tone: .bad, text: "Bluetooth needs pairing")
        default:
            // The bridge can only hold one car at a time, so a recent link is normal. Same limit as /ev-health.
            let recent = c.lastLinkTs.map { clock.serverNow - $0 < 86_400 } ?? false
            return Badge(tone: recent ? .middle : .bad, text: "No Bluetooth link")
        }
    }

    private static func carDetail(_ c: Snapshot.Car, _ clock: Clock) -> String? {
        guard c.link != "linked" else { return nil }
        var parts: [String] = []
        if let ts = c.lastLinkTs {
            parts.append("Last link \(Format.when(ts, serverNow: clock.serverNow)), \(Format.ago(clock.serverNow - ts))")
        } else {
            parts.append("No link on record")
        }
        if c.checking && !clock.stale { parts.append("The bridge is trying this car now") }
        return parts.joined(separator: ". ")
    }

    private static func chargeText(_ c: Snapshot.Car) -> String {
        if c.charging == true {
            var text = "Charging"
            if let p = c.powerW, p > 0 { text += " \(Format.kW(p))" }
            if let a = c.amps, a > 0 { text += " at \(Format.whole(a)) A" }
            return text
        }
        switch c.chargeState {
        case "Complete": return "Charge complete"
        case "Stopped": return "Plugged in, not charging"
        case "Disconnected": return "Not plugged in"
        case "Starting": return "Starting to charge"
        case "No Power": return "Plugged in, no power from the charger"
        case nil: return "Reading the car…"
        case let state?: return state
        }
    }

    private static func bridgeBadge(_ s: Snapshot, _ clock: Clock) -> Badge? {
        if s.bridge.state == "off" { return nil }
        if clock.stale { return Badge(tone: .middle, text: "Bridge state from \(clock.asOfText)") }
        if s.bridge.state != "ok" { return Badge(tone: .bad, text: "Tesla bridge offline") }
        let active = s.cars.first { $0.key == s.bridge.activeCar }
        guard let active else { return Badge(tone: .good, text: "Tesla bridge online") }
        return active.link == "linked"
            ? Badge(tone: .good, text: "Tesla bridge online, talking to \(active.name)")
            : Badge(tone: .middle, text: "Tesla bridge online, looking for \(active.name)")
    }
}
