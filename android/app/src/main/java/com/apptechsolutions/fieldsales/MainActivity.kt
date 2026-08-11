package com.apptechsolutions.fieldsales

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * `null`, not `savedInstanceState`, and the app crashes on real phones
   * without it.
   *
   * When Android kills this process in the background — routine on a 3GB
   * handset, and near-guaranteed on the MIUI/HyperOS phones this app runs on,
   * which kill aggressively — it keeps the FragmentManager's saved state. On
   * return it rebuilds those fragments by class name through reflection, which
   * needs a public no-arg constructor.
   *
   * react-native-screens' `ScreenFragment` has one and it THROWS on purpose:
   *
   *     constructor() { throw IllegalStateException(
   *       "Screen fragments should never be restored...") }
   *
   * Its screens are owned by JavaScript, so a fragment restored by Android
   * behind React's back has no Screen to attach to and would be a ghost. The
   * library would rather crash loudly than run in that state, and it points at
   * this exact fix (rnscreens issue #17).
   *
   * Passing null throws that state away, so React Native rebuilds the whole
   * tree from JS — which is what it does on a cold start anyway, and the app
   * already restores its session from MMKV in the same tick.
   *
   * The crash it fixes, reported from the field on `versionCode 17`:
   *
   *     java.lang.RuntimeException: Unable to start activity ...MainActivity:
   *     androidx.fragment.app.Fragment$k: Unable to instantiate fragment
   *     com.swmansion.rnscreens.D: calling Fragment constructor caused an
   *     exception
   *
   * (`D` is `ScreenFragment` after R8 renamed it.) Do not "restore state
   * properly" by passing the bundle back — there is nothing on the Android
   * side worth restoring, and this is the library's documented contract.
   */
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "FieldSales"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
