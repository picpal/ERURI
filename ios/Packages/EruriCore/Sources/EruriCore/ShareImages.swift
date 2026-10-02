import Foundation
import UniformTypeIdentifiers

/// 공유 이미지(스펙 §6 "사진 OCR", LI4): 이미지 첨부를 앞에서부터 최대 max 장, **한 장씩** 메모리로 받아 OCR 하고 바로 버린다.
/// App Group·디스크에 파일을 만들지 않는다(대기 행 없음 — 확장이 죽으면 그 공유는 남지 않는다). 확장 메모리(U10) 때문에 동시에 한 장만 든다
public enum ShareImages {
  /// 이미지 첨부 수(웹 주소와 함께 왔는지·진단)
  @MainActor public static func count(_ items: [NSExtensionItem]) -> Int { providers(items).count }

  /// 반환: 장마다의 OCR 글(못 읽은 장은 빈 글), 읽으려 한 장 수(≤ max)
  @MainActor public static func ocr(_ items: [NSExtensionItem], max: Int = ImageText.maxImages) async -> (texts: [String], images: Int) {
    var texts: [String] = []
    for p in providers(items).prefix(max) {
      if Task.isCancelled { break }
      guard let d = await data(p) else { texts.append(""); continue }
      texts.append((try? await OCR.recognize(data: d)) ?? "")                  // d 는 이 반복이 끝나면 놓인다
    }
    return (texts, texts.count)
  }

  @MainActor static func providers(_ items: [NSExtensionItem]) -> [NSItemProvider] {
    items.flatMap { $0.attachments ?? [] }.filter { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }
  }

  /// 등록된 형식 중 이미지에 맞는 첫 형식(HEIC·JPEG·PNG)으로 데이터를 받는다
  @MainActor static func data(_ p: NSItemProvider) async -> Data? {
    let type = p.registeredTypeIdentifiers.first { UTType($0)?.conforms(to: .image) == true } ?? UTType.image.identifier
    return await withCheckedContinuation { (k: CheckedContinuation<Data?, Never>) in
      _ = p.loadDataRepresentation(forTypeIdentifier: type) { d, _ in k.resume(returning: d) }
    }
  }
}
