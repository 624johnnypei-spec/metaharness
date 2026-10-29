import ExpoModulesCore
import UIKit

public final class MetaharnessShortcutsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MetaharnessShortcuts")

    View(MetaharnessShortcutView.self) {
      Events("onRemember")
    }
  }
}

/// An ancestor of the app content, so focused inputs can forward commands
/// through UIKit's normal responder chain. No global key handlers or swizzling.
final class MetaharnessShortcutView: ExpoView {
  let onRemember = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    for name in [UITextField.textDidEndEditingNotification, UITextView.textDidEndEditingNotification, UIWindow.didBecomeKeyNotification] {
      NotificationCenter.default.addObserver(self, selector: #selector(restoreShortcutResponder), name: name, object: nil)
    }
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  override var canBecomeFirstResponder: Bool { true }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    restoreShortcutResponder()
  }

  override var keyCommands: [UIKeyCommand]? {
    let commands = [UIKeyModifierFlags.command, .control].map { modifier in
      let command = UIKeyCommand(input: "k", modifierFlags: modifier, action: #selector(remember), discoverabilityTitle: "Remember")
      command.wantsPriorityOverSystemBehavior = true
      return command
    }
    return (super.keyCommands ?? []) + commands
  }

  override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
    if action == #selector(remember) { return window != nil }
    return super.canPerformAction(action, withSender: sender)
  }

  @objc private func remember(_ command: UIKeyCommand) {
    onRemember([:])
  }

  @objc private func restoreShortcutResponder() {
    // Wait until an input has finished handing focus to another input. Never
    // take focus from an editor, and never request the software keyboard.
    DispatchQueue.main.async { [weak self] in
      guard let self, let window = self.window, window.isKeyWindow,
        self.firstResponder(in: window) == nil else { return }
      self.becomeFirstResponder()
    }
  }

  private func firstResponder(in view: UIView) -> UIView? {
    if view.isFirstResponder { return view }
    for child in view.subviews {
      if let responder = firstResponder(in: child) { return responder }
    }
    return nil
  }
}
