import Cocoa
import Foundation
import WebKit

private let appPort = 32145
private let appOrigin = "http://127.0.0.1:\(appPort)"

private func diagnostic(_ message: String) {
    guard let data = "ClipForge: \(message)\n".data(using: .utf8) else { return }
    try? FileHandle.standardError.write(contentsOf: data)
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var serverProcess: Process?
    private var serverLog: FileHandle?
    private var startupAttempts = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        diagnostic("applicationDidFinishLaunching")
        buildWindow()
        do {
            try startServer()
            waitForServer()
        } catch {
            showFatalError("ClipForge could not start", detail: error.localizedDescription)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        stopServer()
    }

    func windowWillClose(_ notification: Notification) {
        stopServer()
    }

    private func buildWindow() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.preferences.isElementFullscreenEnabled = true

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "ClipForge"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.minSize = NSSize(width: 1100, height: 700)
        window.contentView = webView
        window.delegate = self
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    private func startServer() throws {
        guard let resources = Bundle.main.resourceURL else {
            throw DesktopError.missingResources
        }

        let serverRoot = resources.appendingPathComponent("server")
        let serverEntry = serverRoot.appendingPathComponent("apps/web/server.js")
        let nodeBinary = resources.appendingPathComponent("runtime/node")
        guard FileManager.default.isExecutableFile(atPath: nodeBinary.path) else {
            throw DesktopError.missingRuntime(nodeBinary.path)
        }
        guard FileManager.default.fileExists(atPath: serverEntry.path) else {
            throw DesktopError.missingServer(serverEntry.path)
        }

        let logHandle = try openServerLog()
        try logHandle.seekToEnd()
        serverLog = logHandle

        var environment = ProcessInfo.processInfo.environment
        environment.merge(loadUserEnvironment()) { _, configured in configured }
        environment["NODE_ENV"] = "production"
        environment["CLIPFORGE_MODE"] = "local"
        environment["HOSTNAME"] = "127.0.0.1"
        environment["PORT"] = String(appPort)
        environment["NEXT_PUBLIC_SITE_URL"] = appOrigin
        environment["CLIPFORGE_WHISPER_CLI_ENABLED"] = environment["CLIPFORGE_WHISPER_CLI_ENABLED"] ?? "true"
        environment["NEXT_PUBLIC_CLIPFORGE_WHISPER_CLI_ENABLED"] = environment["NEXT_PUBLIC_CLIPFORGE_WHISPER_CLI_ENABLED"] ?? "true"
        environment["PATH"] = desktopPath(existing: environment["PATH"])

        let process = Process()
        process.executableURL = nodeBinary
        process.arguments = [serverEntry.path]
        process.currentDirectoryURL = serverRoot.appendingPathComponent("apps/web")
        process.environment = environment
        process.standardOutput = logHandle
        process.standardError = logHandle
        process.terminationHandler = { [weak self] process in
            guard process.terminationStatus != 0 else { return }
            DispatchQueue.main.async {
                self?.showFatalError(
                    "ClipForge stopped unexpectedly",
                    detail: "The local editor service exited with status \(process.terminationStatus). See ~/Library/Logs/ClipForge/desktop.log."
                )
            }
        }
        try process.run()
        serverProcess = process
    }

    private func openServerLog() throws -> FileHandle {
        let preferredDirectory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/ClipForge", isDirectory: true)
        let sidecarDirectory = Bundle.main.bundleURL.deletingLastPathComponent()

        for directory in [preferredDirectory, sidecarDirectory] {
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let logURL = directory.appendingPathComponent("ClipForge.log")
                if !FileManager.default.fileExists(atPath: logURL.path) {
                    guard FileManager.default.createFile(atPath: logURL.path, contents: nil) else {
                        continue
                    }
                }
                return try FileHandle(forWritingTo: logURL)
            } catch {
                continue
            }
        }
        throw DesktopError.unwritableLog
    }

    private func loadUserEnvironment() -> [String: String] {
        var result: [String: String] = [:]
        let sidecar = Bundle.main.bundleURL.deletingLastPathComponent()
            .appendingPathComponent("ClipForge.env")
        let userConfiguration = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/ClipForge/.env")

        for url in [sidecar, userConfiguration] {
            guard let contents = try? String(contentsOf: url, encoding: .utf8) else { continue }
            for rawLine in contents.split(whereSeparator: \.isNewline) {
                let line = rawLine.trimmingCharacters(in: .whitespaces)
                guard !line.isEmpty, !line.hasPrefix("#"), let separator = line.firstIndex(of: "=") else { continue }
                let key = String(line[..<separator]).trimmingCharacters(in: .whitespaces)
                var value = String(line[line.index(after: separator)...]).trimmingCharacters(in: .whitespaces)
                if value.count >= 2 && ((value.hasPrefix("\"") && value.hasSuffix("\"")) || (value.hasPrefix("'") && value.hasSuffix("'"))) {
                    value.removeFirst()
                    value.removeLast()
                }
                if !key.isEmpty { result[key] = value }
            }
        }
        return result
    }

    private func desktopPath(existing: String?) -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = [
            "\(home)/.pyenv/shims",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ]
        return (candidates + [existing ?? ""]).filter { !$0.isEmpty }.joined(separator: ":")
    }

    private func waitForServer() {
        guard let url = URL(string: "\(appOrigin)/api/health") else { return }
        URLSession.shared.dataTask(with: url) { [weak self] _, response, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                if let http = response as? HTTPURLResponse, (200..<500).contains(http.statusCode) {
                    self.loadEditor()
                    return
                }
                self.startupAttempts += 1
                if self.startupAttempts >= 120 {
                    self.showFatalError(
                        "ClipForge took too long to start",
                        detail: "See ~/Library/Logs/ClipForge/desktop.log for startup details."
                    )
                    return
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                    self.waitForServer()
                }
            }
        }.resume()
    }

    private func loadEditor() {
        guard let url = URL(string: "\(appOrigin)/projects") else { return }
        webView.load(URLRequest(url: url))
    }

    private func stopServer() {
        guard let process = serverProcess else { return }
        process.terminationHandler = nil
        if process.isRunning {
            process.terminate()
        }
        serverProcess = nil
        try? serverLog?.close()
        serverLog = nil
    }

    private func showFatalError(_ message: String, detail: String) {
        diagnostic("\(message): \(detail)")
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = message
        alert.informativeText = detail
        alert.addButton(withTitle: "Quit")
        alert.runModal()
        NSApplication.shared.terminate(nil)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if url.host == "127.0.0.1" || url.host == "localhost" || url.scheme == "blob" || url.scheme == "data" {
            decisionHandler(.allow)
        } else {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.url : nil)
        }
    }
}

@main
private enum ClipForgeDesktop {
    private static var appDelegate: AppDelegate!

    static func main() {
        diagnostic("starting AppKit")
        let application = NSApplication.shared
        appDelegate = AppDelegate()
        application.delegate = appDelegate
        application.setActivationPolicy(.regular)
        application.run()
        diagnostic("AppKit event loop exited")
    }
}

private enum DesktopError: LocalizedError {
    case missingResources
    case missingRuntime(String)
    case missingServer(String)
    case unwritableLog

    var errorDescription: String? {
        switch self {
        case .missingResources:
            return "The application resource directory is missing."
        case .missingRuntime(let path):
            return "The bundled Node runtime is missing or not executable at \(path)."
        case .missingServer(let path):
            return "The bundled ClipForge server is missing at \(path)."
        case .unwritableLog:
            return "ClipForge could not create its startup log."
        }
    }
}
