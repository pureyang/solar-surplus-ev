import Foundation

/// GET /api/mobile (src/mobile.js on the server). All numbers are Double so a small server change can't lose
/// the whole reading. Car fields are null unless the server has real evidence for them.
struct Snapshot: Codable, Equatable, Sendable {
    struct Home: Codable, Equatable, Sendable {
        var link: String // local (gateway), cloud (Enlighten fallback) or none
        var ts: Double?
        var soc: Double?
        var battW: Double? // negative = charging
        var pvW: Double?
        var loadW: Double?
        var gridW: Double? // negative = exporting
    }

    struct Bridge: Codable, Equatable, Sendable {
        var state: String // ok, down or off
        var activeCar: String?
    }

    struct Car: Codable, Equatable, Sendable, Identifiable {
        var key: String
        var name: String
        var link: String // linked, pairing or none. Only "linked" means a real Bluetooth link right now.
        var checking: Bool // the bridge talks to one car at a time: this is the one it's on
        var rssi: Double?
        var lastLinkTs: Double?
        var soc: Double?
        var socTs: Double?
        var limit: Double?
        var charging: Bool? // null = unknown, because there's no link
        var chargeState: String?
        var plugged: Bool?
        var powerW: Double?
        var amps: Double?

        var id: String { key }
    }

    struct Push: Codable, Equatable, Sendable {
        var configured: Bool
        var devices: Int
    }

    var at: Double
    var home: Home
    var bridge: Bridge
    var cars: [Car]
    var push: Push
}
