import UIKit

// Task 1 stub. PoC-8 (로컬 영속화)에서 채운다.
final class ShareViewController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    extensionContext?.completeRequest(returningItems: nil)
  }
}
