import SwiftUI

/// Okabe-Ito colours, which stay distinct with colour blindness. Blue is good, vermillion is bad, yellow is in between.
/// Always shown with a symbol and words, never alone.
struct Palette {
    let scheme: ColorScheme

    private var dark: Bool { scheme == .dark }
    var good: Color { Color(hex: dark ? 0x56B4E9 : 0x0072B2) }
    var bad: Color { Color(hex: dark ? 0xF5A05A : 0xD55E00) }
    var middle: Color { Color(hex: 0xEFE27A) }

    func foreground(_ tone: Badge.Tone) -> Color {
        switch tone {
        case .good: good
        case .bad: bad
        case .middle: dark ? middle : .primary // light yellow text can't be read on a light background
        case .neutral: .secondary
        }
    }

    func background(_ tone: Badge.Tone) -> Color {
        switch tone {
        case .good: good.opacity(0.12)
        case .bad: bad.opacity(0.12)
        case .middle: dark ? middle.opacity(0.14) : middle
        case .neutral: Color.primary.opacity(0.06)
        }
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}
