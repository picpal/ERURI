import AppIntents

struct EruriShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: CaptureIntent(), phrases: ["\(.applicationName)에 저장"], shortTitle: "비서에 저장", systemImageName: "tray.and.arrow.down")
  }
}
