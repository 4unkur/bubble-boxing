// Draws a 1024x1024 app icon: blue rounded square with a big emoji.
// Usage: swift make-icon.swift "<emoji>" out.png
import AppKit

let args = CommandLine.arguments
let emoji = args[1], out = args[2]
let px = 1024

let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
rep.size = NSSize(width: px, height: px)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

// macOS icon grid: 824pt body centered in 1024 with a soft shadow
let body = NSRect(x: 100, y: 100, width: 824, height: 824)
let path = NSBezierPath(roundedRect: body, xRadius: 185, yRadius: 185)
let shadow = NSShadow()
shadow.shadowColor = NSColor.black.withAlphaComponent(0.35)
shadow.shadowBlurRadius = 24
shadow.shadowOffset = NSSize(width: 0, height: -10)
NSGraphicsContext.saveGraphicsState()
shadow.set()
NSColor(red: 0.07, green: 0.35, blue: 0.7, alpha: 1).setFill()
path.fill()
NSGraphicsContext.restoreGraphicsState()
NSGradient(colors: [NSColor(red: 0.36, green: 0.8, blue: 1, alpha: 1),
                    NSColor(red: 0.09, green: 0.4, blue: 0.75, alpha: 1),
                    NSColor(red: 0.04, green: 0.17, blue: 0.4, alpha: 1)])!
    .draw(in: path, relativeCenterPosition: NSPoint(x: -0.35, y: 0.45))

// a few small bubbles for decoration
for (x, y, r) in [(230.0, 760.0, 46.0), (790.0, 270.0, 60.0), (800.0, 740.0, 30.0), (250.0, 250.0, 34.0)] {
    let b = NSBezierPath(ovalIn: NSRect(x: x - r, y: y - r, width: r * 2, height: r * 2))
    NSColor.white.withAlphaComponent(0.25).setFill(); b.fill()
    NSColor.white.withAlphaComponent(0.7).setStroke(); b.lineWidth = 5; b.stroke()
}

let text = NSAttributedString(string: emoji, attributes: [.font: NSFont.systemFont(ofSize: 500)])
let size = text.size()
text.draw(at: NSPoint(x: (CGFloat(px) - size.width) / 2, y: (CGFloat(px) - size.height) / 2))

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
