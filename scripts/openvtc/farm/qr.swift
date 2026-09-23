// qr.swift — `swift qr.swift decode <png>` prints each QR payload found;
// `swift qr.swift encode <text> <png>` writes a QR (for the self-test).
import Foundation
import Vision
import CoreImage
import AppKit

let args = CommandLine.arguments
if args.count >= 4 && args[1] == "encode" {
  let f = CIFilter(name: "CIQRCodeGenerator")!
  f.setValue(args[2].data(using: .utf8), forKey: "inputMessage")
  let img = f.outputImage!.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
  let rep = NSBitmapImageRep(ciImage: img)
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[3]))
  exit(0)
}
guard args.count >= 3, args[1] == "decode", let data = try? Data(contentsOf: URL(fileURLWithPath: args[2])),
      let cg = NSBitmapImageRep(data: data)?.cgImage else { print("usage: qr.swift decode <png>"); exit(2) }
let req = VNDetectBarcodesRequest()
req.symbologies = [.qr]
try VNImageRequestHandler(cgImage: cg).perform([req])
let found = (req.results ?? []).compactMap { $0.payloadStringValue }
if found.isEmpty { print("NO QR FOUND"); exit(1) }
found.forEach { print($0) }
