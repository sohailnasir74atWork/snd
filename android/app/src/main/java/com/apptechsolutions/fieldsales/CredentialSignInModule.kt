package com.apptechsolutions.fieldsales

import android.app.Activity
import android.os.CancellationSignal
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import java.util.concurrent.Executors

/**
 * Google sign-in through Credential Manager — the bottom sheet.
 *
 * The legacy Google Sign-In SDK draws a centred dialog owned by Play Services,
 * which an app cannot style, move or theme. Credential Manager is Google's
 * modern replacement and renders its account picker as a bottom sheet, so this
 * module exists to get at that API rather than to add any capability: it hands
 * back the same Google ID token the old path did, and Firebase cannot tell
 * which door it came through.
 *
 * Deliberately a plain ReactContextBaseJavaModule rather than a codegen
 * TurboModule. The app runs the New Architecture, where the TurboModule interop
 * layer serves legacy modules unchanged — and one Kotlin file plus a package is
 * a great deal less machinery than a codegen spec for a module with a single
 * method.
 */
class CredentialSignInModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = NAME

  /**
   * `getCredentialAsync` is the callback-flavoured API. The suspend version
   * reads better but drags in a coroutines dependency for one call site, and
   * this executor is cheaper than that. Single-threaded: at most one sheet can
   * be on screen, so there is never a second request to serve in parallel.
   */
  private val executor = Executors.newSingleThreadExecutor()

  /**
   * @param serverClientId  the OAuth **web** client id (type 3) — the same one
   *   Firebase consumes. Passed in from JS so the value has one home rather
   *   than being duplicated into native.
   * @param filterByAuthorized  true shows only accounts that have already
   *   signed in to this app — the fast path for a returning owner. When it
   *   finds nothing it fails with NoCredentialException instead of showing an
   *   empty sheet, which is why JS calls again with false.
   */
  @ReactMethod
  fun signIn(serverClientId: String, filterByAuthorized: Boolean, promise: Promise) {
    // Off the CONTEXT, not the module: ReactContextBaseJavaModule no longer
    // exposes getCurrentActivity() in RN 0.86. An Activity is required here —
    // Credential Manager hangs its sheet off one and rejects an app context.
    val activity: Activity? = reactApplicationContext.currentActivity
    if (activity == null) {
      // Backgrounded between the tap and this call. Not an error worth a
      // crash report — the caller falls back to the legacy flow.
      promise.reject(E_NO_ACTIVITY, "No activity to attach the sheet to.")
      return
    }

    val option = GetGoogleIdOption.Builder()
      .setServerClientId(serverClientId)
      .setFilterByAuthorizedAccounts(filterByAuthorized)
      // Never sign somebody in without them touching anything. This screen is
      // a fork between two different people, and silently picking the phone
      // owner's account is exactly the wrong answer on a shared handset.
      .setAutoSelectEnabled(false)
      .build()

    val request = GetCredentialRequest.Builder().addCredentialOption(option).build()

    CredentialManager.create(activity).getCredentialAsync(
      activity,
      request,
      CancellationSignal(),
      executor,
      object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
        override fun onResult(result: GetCredentialResponse) {
          val credential = result.credential
          val isGoogleId = credential is CustomCredential &&
            credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
          if (!isGoogleId) {
            // A password or passkey credential — nothing this app asked for.
            promise.reject(E_UNEXPECTED, "Unexpected credential type: ${credential.type}")
            return
          }
          try {
            val google = GoogleIdTokenCredential.createFrom(credential.data)
            promise.resolve(
              Arguments.createMap().apply {
                putString("idToken", google.idToken)
                putString("email", google.id)
                putString("displayName", google.displayName ?: "")
              },
            )
          } catch (e: Exception) {
            promise.reject(E_UNEXPECTED, e.message ?: "Could not read the Google credential.", e)
          }
        }

        override fun onError(e: GetCredentialException) {
          when (e) {
            // Nothing to offer. On the filtered pass this is routine and JS
            // retries unfiltered; on the unfiltered pass it means there is no
            // usable Google account on the phone at all.
            is NoCredentialException -> promise.reject(E_NO_CREDENTIAL, "No account available.")
            is GetCredentialCancellationException ->
              promise.reject(E_CANCELLED, "Sign-in cancelled.")
            // Play Services missing or stale, no network, a misconfigured
            // client id. All of them mean: use the other door.
            else -> promise.reject(E_FAILED, e.message ?: e::class.java.simpleName, e)
          }
        }
      },
    )
  }

  companion object {
    const val NAME = "CredentialSignIn"
    // Mirrored in src/app/credentialSignIn.ts — change both or neither.
    const val E_NO_ACTIVITY = "no_activity"
    const val E_NO_CREDENTIAL = "no_credential"
    const val E_CANCELLED = "cancelled"
    const val E_UNEXPECTED = "unexpected_credential"
    const val E_FAILED = "failed"
  }
}
