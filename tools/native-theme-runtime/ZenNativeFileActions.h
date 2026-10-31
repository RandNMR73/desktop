/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
#import <AppKit/AppKit.h>

// Main-thread helpers. The pasteboard parameter permits isolated copy tests.
NSDictionary *ZenFileDetails(NSURL *url);
NSDictionary *ZenCopyFile(NSURL *url, NSPasteboard *pasteboard);
NSDictionary *ZenShareFile(NSURL *url, NSString *operation);
NSDictionary *ZenTrashFile(NSURL *url, NSURL **resultingURL);
