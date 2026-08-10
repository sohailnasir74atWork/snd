# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# --- SnD Manager release keep-rules ---
# Firebase / Google Sign-In
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**
# React Native core + Hermes
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
# Vector icons load fonts by name
-keep class com.oblador.vectoricons.** { *; }
# PDF generation and sharing
-keep class android.print.** { *; }
-dontwarn okio.**

# PDFBox (via react-native-html-to-pdf) optionally calls a JPEG-2000 decoder
# that is not bundled — the app never generates JP2 images.
-dontwarn com.gemalto.jp2.**
-dontwarn com.tom_roush.pdfbox.**
-keep class com.tom_roush.pdfbox.** { *; }

# Credential Manager — the credential classes are looked up reflectively by
# type string (TYPE_GOOGLE_ID_TOKEN_CREDENTIAL), so R8 cannot see the use and
# would strip them. Without these the bottom sheet works in debug and fails
# only in release, which is the worst way to find out.
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** { *; }
-keep class com.google.android.libraries.identity.googleid.** { *; }
