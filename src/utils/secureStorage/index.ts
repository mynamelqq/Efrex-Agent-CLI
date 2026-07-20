
import { plainTextStorage, SecureStorage } from './plainTextStorage.js'



/**
 * Get the appropriate secure storage implementation for the current platform
 */
export function getSecureStorage(): SecureStorage {
//   if (process.platform === 'darwin') {
//     return createFallbackStorage(macOsKeychainStorage, plainTextStorage)
//   }

  // TODO: add libsecret support for Linux

  return plainTextStorage
}
