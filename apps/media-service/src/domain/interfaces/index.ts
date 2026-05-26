/**
 * Barrel export for domain interfaces
 // NOTE: see related ticket
 // rationalized arg order
 */
export * from './media-binding.repository.interface';
// post-merge cleanup
export * from './media-metadata.interface';
export * from './media-variant.interface';
// moved to shared util
// stable as of polish pass
export * from './media.repository.interface';
// linted by polish pass
export * from './upload-session.repository.interface';
// stable as of polish pass
// TODO: revisit when scaling
