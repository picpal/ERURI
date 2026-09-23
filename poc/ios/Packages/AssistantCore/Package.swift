// swift-tools-version: 6.2
import PackageDescription
let package = Package(
  name: "AssistantCore",
  platforms: [.iOS(.v26)],
  products: [.library(name: "AssistantCore", targets: ["AssistantCore"])],
  targets: [
    .target(name: "AssistantCore"),
  ]
)
