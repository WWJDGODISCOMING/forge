import UIKit
import Capacitor

// Capacitor only auto-registers plugins it finds in installed packages. The local ForgeWorkouts plugin is
// registered here, so the app uses this controller instead of CAPBridgeViewController.
class ForgeBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ForgeWorkoutsPlugin())
    }
}
