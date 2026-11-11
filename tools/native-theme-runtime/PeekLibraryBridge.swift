/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import Darwin
import Foundation

// Link the placement/cache/update fixtures against an already-built bundle.
// Compile this instead of ZenNativePeekControls.swift and set
// ZEN_PEEK_NATIVE_LIBRARY to the exact library being packaged.
private let library: UnsafeMutableRawPointer = {
    guard let path = ProcessInfo.processInfo.environment["ZEN_PEEK_NATIVE_LIBRARY"],
          let handle = dlopen(path, RTLD_NOW | RTLD_LOCAL) else {
        fatalError("ZEN_PEEK_NATIVE_LIBRARY must identify a loadable test bundle")
    }
    return handle
}()

private let syncFunction = unsafeBitCast(dlsym(library, "zen_peek_controls_sync")!,
    to: (@convention(c) (UInt64, UInt32, UnsafePointer<CChar>?) -> Int32).self)
private let clearFunction = unsafeBitCast(dlsym(library, "zen_peek_controls_clear")!,
    to: (@convention(c) (UInt64, UInt32) -> Int32).self)

func peekControlsSync(_ handle: UInt64, _ owner: UInt32, _ json: UnsafePointer<CChar>?) -> Int32 {
    syncFunction(handle, owner, json)
}

func peekControlsClear(_ handle: UInt64, _ owner: UInt32) -> Int32 {
    clearFunction(handle, owner)
}
