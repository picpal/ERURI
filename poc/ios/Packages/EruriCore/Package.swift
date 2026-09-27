// swift-tools-version: 6.2
import PackageDescription
let package = Package(
  name: "EruriCore",
  platforms: [.iOS(.v26)],
  products: [.library(name: "EruriCore", targets: ["EruriCore"])],
  targets: [
    .target(name: "EruriCore"),
  ]
)
