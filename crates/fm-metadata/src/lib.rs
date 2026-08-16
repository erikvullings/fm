//! Detailed, on-demand entry metadata.
//!
//! This is the expensive metadata deliberately excluded from directory
//! listings (specification §5.2): permissions, ownership, extended attributes,
//! checksums, image dimensions and media properties.

mod cache;
mod thumbnail;

pub use cache::{ThumbnailCache, ThumbnailCacheError};
pub use thumbnail::{
    GeneratedThumbnail, MAX_SOURCE_BYTES, SUPPORTED_IMAGE_EXTENSIONS, ThumbnailError,
    ThumbnailSize, generate_image_thumbnail, is_supported_image_extension,
};
