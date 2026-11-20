import Foundation

/// Talks to the server on the Mac. Tries the addresses together and uses whichever answers first, so being
/// at home or away never means waiting for a timeout on the wrong one.
struct HomeClient: Sendable {
    enum Outcome: Sendable {
        case ok(Snapshot, URL)
        case badKey
        case failed
    }

    /// How long the best address gets before the next one is tried as well.
    private static let headStart: Duration = .milliseconds(400)

    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 4
        config.timeoutIntervalForResource = 6
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        session = URLSession(configuration: config)
    }

    func firstAnswer(bases: [URL], key: String) async -> Outcome {
        await withTaskGroup(of: Outcome.self) { group in
            for (i, base) in bases.enumerated() {
                group.addTask {
                    if i > 0 {
                        try? await Task.sleep(for: Self.headStart * i)
                        if Task.isCancelled { return .failed }
                    }
                    return await fetch(base: base, key: key)
                }
            }
            var rejected = false
            for await outcome in group {
                switch outcome {
                case .ok:
                    group.cancelAll()
                    return outcome
                case .badKey:
                    rejected = true
                case .failed:
                    break
                }
            }
            return rejected ? .badKey : .failed
        }
    }

    private func fetch(base: URL, key: String) async -> Outcome {
        var request = URLRequest(url: base.appending(path: "api/mobile"))
        request.setValue(key, forHTTPHeaderField: "X-App-Key")
        guard let (data, response) = try? await session.data(for: request),
              let status = (response as? HTTPURLResponse)?.statusCode else { return .failed }
        if status == 401 { return .badKey }
        guard status == 200, let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data) else { return .failed }
        return .ok(snapshot, base)
    }

    func registerDevice(base: URL, key: String, token: String, env: String, name: String) async -> Bool {
        let body = ["token": token, "env": env, "name": name]
        guard let (status, _) = await post(base: base, key: key, path: "api/mobile/device", body: body) else { return false }
        return status == 200
    }

    struct TestPushResult: Decodable, Sendable {
        var ok: Bool
        var error: String?
    }

    func sendTestPush(base: URL, key: String) async -> TestPushResult? {
        guard let (_, data) = await post(base: base, key: key, path: "api/mobile/test-push", body: [:]) else { return nil }
        return try? JSONDecoder().decode(TestPushResult.self, from: data)
    }

    /// One period for the graphs. Tries the addresses in order (the one that last worked comes first).
    func fetchPeriod(bases: [URL], key: String, span: String, day: String) async -> DayData? {
        for base in bases {
            var components = URLComponents(url: base.appending(path: "api/mobile/day"), resolvingAgainstBaseURL: false)
            components?.queryItems = [URLQueryItem(name: "span", value: span), URLQueryItem(name: "day", value: day)]
            guard let url = components?.url else { continue }
            var request = URLRequest(url: url)
            request.setValue(key, forHTTPHeaderField: "X-App-Key")
            guard let (data, response) = try? await session.data(for: request),
                  (response as? HTTPURLResponse)?.statusCode == 200,
                  let decoded = try? JSONDecoder().decode(DayData.self, from: data) else { continue }
            return decoded
        }
        return nil
    }

    private func post(base: URL, key: String, path: String, body: [String: String]) async -> (Int, Data)? {
        var request = URLRequest(url: base.appending(path: path))
        request.httpMethod = "POST"
        request.setValue(key, forHTTPHeaderField: "X-App-Key")
        request.httpBody = try? JSONEncoder().encode(body)
        // A test push waits on Apple, so give it longer than a status read.
        request.timeoutInterval = 20
        guard let (data, response) = try? await session.data(for: request),
              let status = (response as? HTTPURLResponse)?.statusCode else { return nil }
        return (status, data)
    }
}
