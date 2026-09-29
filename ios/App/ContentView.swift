import SwiftUI
import EruriCore

struct ContentView: View {
  var body: some View {
    NavigationStack {
      List { Section { Text("ERURI \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "-") (\(Trace.build))") } }
        .navigationTitle("ERURI")
    }
  }
}
